import { type MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";
import { type AuthSessionRepository } from "#/application/ports/auth";
import { unauthorized } from "#/interfaces/http/responses";
import { jwtPayloadSchema } from "#/interfaces/http/validators/jwt.schema";

interface JwtMiddlewareDeps {
  secret: string;
  authSessionRepository?: AuthSessionRepository;
  authSessionCookieName?: string;
}

const extractBearerToken = (
  authorizationHeader: string | undefined,
): string | undefined => {
  if (!authorizationHeader) return undefined;
  const [scheme, value] = authorizationHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) {
    return undefined;
  }
  return value;
};

export const createJwtMiddleware = (
  depsOrSecret: string | JwtMiddlewareDeps,
): MiddlewareHandler => {
  const deps: JwtMiddlewareDeps =
    typeof depsOrSecret === "string" ? { secret: depsOrSecret } : depsOrSecret;
  const cookieName = deps.authSessionCookieName ?? "wildfire_session_token";

  return async (c, next) => {
    const bearerToken = extractBearerToken(
      c.req.header("authorization") ?? c.req.header("Authorization"),
    );
    const cookieToken = getCookie(c, cookieName);
    const token = cookieToken ?? bearerToken;

    if (!token) {
      return unauthorized(c, "Unauthorized");
    }

    try {
      const payload = await verify(token, deps.secret, "HS256");
      c.set("jwtPayload", payload);
      const parsed = jwtPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        return unauthorized(c, "Invalid token");
      }
      if (
        deps.authSessionRepository &&
        (!parsed.data.sid ||
          !(await deps.authSessionRepository.isActive(
            parsed.data.sid,
            new Date(),
          )))
      ) {
        return unauthorized(c, "Session is invalid or revoked");
      }
      await next();
    } catch {
      return unauthorized(c, "Unauthorized");
    }
  };
};
