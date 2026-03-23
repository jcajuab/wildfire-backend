import { timingSafeEqual } from "node:crypto";
import { type MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { logger } from "#/infrastructure/observability/logger";

const CSRF_EXEMPT_PATHS = new Set(["/v1/auth/login"]);

export const createCsrfMiddleware = (
  sessionCookieName: string,
  csrfCookieName: string,
): MiddlewareHandler => {
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return next();
    }

    if (CSRF_EXEMPT_PATHS.has(c.req.path)) {
      return next();
    }

    const sessionCookie = getCookie(c, sessionCookieName);
    if (!sessionCookie) {
      return next();
    }

    const csrfHeader = c.req.header("x-csrf-token");
    const csrfCookie = getCookie(c, csrfCookieName);

    const headerBuf = Buffer.from(csrfHeader ?? "");
    const cookieBuf = Buffer.from(csrfCookie ?? "");
    const tokenMismatch =
      !csrfHeader ||
      !csrfCookie ||
      headerBuf.length !== cookieBuf.length ||
      !timingSafeEqual(headerBuf, cookieBuf);
    if (tokenMismatch) {
      logger.warn(
        {
          event: "csrf.validation.failed",
          component: "csrf-middleware",
          path: c.req.path,
          ip:
            c.req.header("x-forwarded-for") ??
            c.req.header("x-real-ip") ??
            "unknown",
        },
        "CSRF validation failed",
      );
      return c.json({ error: "CSRF validation failed" }, 403);
    }

    return next();
  };
};
