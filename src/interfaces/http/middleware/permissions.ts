import { type MiddlewareHandler } from "hono";
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
}) => {
  const jwtMiddleware = createJwtMiddleware(deps.jwtSecret);
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

      const allowed = await checkPermission.execute({
        userId: parsed.data.sub,
        required: permission,
      });

      if (!allowed) {
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
