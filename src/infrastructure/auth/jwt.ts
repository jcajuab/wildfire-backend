import { type MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import {
  type AuthSessionRepository,
  type TokenIssuer,
} from "#/application/ports/auth";
import { unauthorized } from "#/interfaces/http/responses";
import { jwtPayloadSchema } from "#/interfaces/http/validators/jwt.schema";

interface JwtTokenIssuerDeps {
  secret: string;
  issuer?: string;
}

export class JwtTokenIssuer implements TokenIssuer {
  constructor(private readonly deps: JwtTokenIssuerDeps) {}

  issueToken(input: {
    subject: string;
    issuedAt: number;
    expiresAt: number;
    issuer?: string;
    email?: string;
    sessionId?: string;
  }): Promise<string> {
    const payload = {
      sub: input.subject,
      email: input.email,
      iat: input.issuedAt,
      exp: input.expiresAt,
      iss: input.issuer ?? this.deps.issuer,
      ...(input.sessionId
        ? {
            sid: input.sessionId,
            jti: input.sessionId,
          }
        : {}),
    };

    return sign(payload, this.deps.secret);
  }
}

interface JwtMiddlewareDeps {
  secret: string;
  authSessionRepository?: AuthSessionRepository;
  authSessionCookieName?: string;
  allowBearerFallback?: boolean;
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
        parsed.data.sid &&
        !(await deps.authSessionRepository.isActive(
          parsed.data.sid,
          new Date(),
        ))
      ) {
        return unauthorized(c, "Session revoked");
      }
      if (
        deps.authSessionRepository &&
        !parsed.data.sid &&
        deps.allowBearerFallback === false
      ) {
        return unauthorized(c, "Legacy token flow disabled");
      }
      await next();
    } catch {
      return unauthorized(c, "Unauthorized");
    }
  };
};
