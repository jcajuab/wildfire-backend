import { type MiddlewareHandler } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
import { type AuthorizationRepository } from "#/application/ports/rbac";
import { CheckPermissionUseCase } from "#/application/use-cases/rbac";
import { createJwtMiddleware } from "#/infrastructure/auth/jwt";
import {
  type JwtUserVariables,
  requireJwtUser,
} from "#/interfaces/http/middleware/jwt-user";
import { forbidden, unauthorized } from "#/interfaces/http/responses";
import { jwtPayloadSchema } from "#/interfaces/http/validators/jwt.schema";

export const createPermissionMiddleware = (deps: {
  jwtSecret: string;
  authorizationRepository: AuthorizationRepository;
  authSessionRepository?: AuthSessionRepository;
  authSessionCookieName?: string;
  authSessionDualMode?: boolean;
}) => {
  const jwtMiddleware = createJwtMiddleware({
    secret: deps.jwtSecret,
    authSessionRepository: deps.authSessionRepository,
    authSessionCookieName: deps.authSessionCookieName,
    allowBearerFallback: deps.authSessionDualMode ?? true,
  });
  const checkPermission = new CheckPermissionUseCase({
    authorizationRepository: deps.authorizationRepository,
  });

  const requirePermission = (
    permission: string,
  ): MiddlewareHandler<{ Variables: JwtUserVariables }> => {
    return async (c, next) => {
      const parsed = jwtPayloadSchema.safeParse(c.get("jwtPayload"));
      if (!parsed.success) {
        return unauthorized(c, "Invalid token");
      }

      c.set("userId", parsed.data.sub);
      if (parsed.data.email) {
        c.set("userEmail", parsed.data.email);
      }
      // Extract sessionId matching requireJwtUser pattern
      if (parsed.data.sid) {
        c.set("sessionId", parsed.data.sid);
      } else if (parsed.data.jti) {
        c.set("sessionId", parsed.data.jti);
      } else if (parsed.data.iat) {
        c.set("sessionId", `${parsed.data.sub}:${parsed.data.iat}`);
      }

      const allowed = await checkPermission.execute({
        userId: parsed.data.sub,
        required: permission,
      });

      if (!allowed) {
        c.set("action", "authz.permission.deny");
        c.set("resourceType", "permission");
        c.set("resourceId", permission);
        (c as unknown as { set: (k: string, v: string) => void }).set(
          "deniedPermission",
          permission,
        );
        (c as unknown as { set: (k: string, v: string) => void }).set(
          "denyErrorCode",
          "FORBIDDEN",
        );
        (c as unknown as { set: (k: string, v: string) => void }).set(
          "denyErrorType",
          "PermissionDenied",
        );
        return forbidden(c, "Forbidden");
      }

      await next();
    };
  };

  const authorize = (permission: string) =>
    [jwtMiddleware, requirePermission(permission)] as const satisfies readonly [
      MiddlewareHandler,
      MiddlewareHandler<{ Variables: JwtUserVariables }>,
    ];

  return { jwtMiddleware, requirePermission, requireJwtUser, authorize };
};
