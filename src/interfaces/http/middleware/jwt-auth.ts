import { type MiddlewareHandler } from "hono";
import { verify } from "hono/jwt";
import { unauthorized } from "#/interfaces/http/responses";
import { jwtPayloadSchema } from "#/interfaces/http/validators/jwt.schema";

interface JwtMiddlewareDeps {
  secret: string;
  authSessionRepository?: unknown;
  authSessionCookieName?: string;
}

const extractBearerToken = (
  authorizationHeader: string | undefined,
): string | undefined => {
  if (authorizationHeader == null || authorizationHeader.length === 0) {
    return undefined;
  }

  const [scheme, value] = authorizationHeader.split(" ");
  const normalizedScheme = scheme?.toLowerCase();
  const hasValue = typeof value === "string" && value.length > 0;
  if (normalizedScheme === "bearer" && hasValue) {
    return value;
  }

  return undefined;
};

export const createJwtMiddleware = (
  depsOrSecret: string | JwtMiddlewareDeps,
): MiddlewareHandler => {
  const deps: JwtMiddlewareDeps =
    typeof depsOrSecret === "string" ? { secret: depsOrSecret } : depsOrSecret;

  return async (c, next) => {
    const token = extractBearerToken(
      c.req.header("authorization") ?? c.req.header("Authorization"),
    );

    if (token == null) {
      return unauthorized(c, "Unauthorized");
    }

    try {
      const payload = await verify(token, deps.secret, "HS256");
      const parsed = jwtPayloadSchema.safeParse(payload);
      if (parsed.success === false) {
        return unauthorized(c, "Invalid token");
      }

      c.set("jwtPayload", parsed.data);
      await next();
    } catch {
      return unauthorized(c, "Unauthorized");
    }
  };
};
