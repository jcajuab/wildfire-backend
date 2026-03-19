import { type MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { logger } from "#/infrastructure/observability/logger";

export const createCsrfMiddleware = (
  sessionCookieName: string,
  csrfCookieName: string,
): MiddlewareHandler => {
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return next();
    }

    const sessionCookie = getCookie(c, sessionCookieName);
    if (!sessionCookie) {
      return next();
    }

    const csrfHeader = c.req.header("x-csrf-token");
    const csrfCookie = getCookie(c, csrfCookieName);

    if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
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
