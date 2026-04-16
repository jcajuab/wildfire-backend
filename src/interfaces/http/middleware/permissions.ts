import { type MiddlewareHandler } from "hono";
import {
  ADMIN_PERMISSION,
  CANONICAL_STANDARD_RESOURCE_ACTIONS,
  canonicalPermissionKey,
} from "#/domain/rbac/canonical-permissions";
import { createJwtMiddleware } from "#/interfaces/http/middleware/jwt-auth";
import {
  type JwtUserVariables,
  requireJwtUser,
} from "#/interfaces/http/middleware/jwt-user";
import { forbidden, unauthorized } from "#/interfaces/http/responses";
import { jwtPayloadSchema } from "#/interfaces/http/validators/jwt.schema";

export const createPermissionMiddleware = (deps: {
  jwtSecret: string;
  checkPermissionUseCase: unknown;
  authSessionRepository: unknown;
  authSessionCookieName: string;
}) => {
  const jwtMiddleware = createJwtMiddleware({
    secret: deps.jwtSecret,
  });
  const canonicalPermissions = new Set(
    CANONICAL_STANDARD_RESOURCE_ACTIONS.map((permission) =>
      canonicalPermissionKey(permission),
    ),
  );
  canonicalPermissions.add(canonicalPermissionKey(ADMIN_PERMISSION));

  const normalizePermission = (permission: string): string => {
    const normalized = permission.trim();
    if (!canonicalPermissions.has(normalized)) {
      throw new Error(`Unknown permission key: ${permission}`);
    }
    return normalized;
  };

  const requirePermission = (
    permission: string,
  ): MiddlewareHandler<{ Variables: JwtUserVariables }> => {
    const requiredPermission = normalizePermission(permission);

    return async (c, next) => {
      const parsed = jwtPayloadSchema.safeParse(c.get("jwtPayload"));
      if (!parsed.success) {
        return unauthorized(c, "Invalid token");
      }

      c.set("userId", parsed.data.sub);
      c.set("username", parsed.data.username);
      if (parsed.data.email) {
        c.set("userEmail", parsed.data.email);
      }

      const allowed =
        parsed.data.isAdmin ||
        parsed.data.permissions.includes(requiredPermission);

      if (!allowed) {
        c.set("action", "authz.permission.deny");
        c.set("resourceType", "permission");
        c.set("resourceId", requiredPermission);
        c.set("deniedPermission", requiredPermission);
        c.set("denyErrorCode", "FORBIDDEN");
        c.set("denyErrorType", "PermissionDenied");
        return forbidden(c, "Forbidden");
      }

      await next();
    };
  };

  const authorize = (permission: string) => {
    const requiredPermission = normalizePermission(permission);
    return [
      jwtMiddleware,
      requirePermission(requiredPermission),
    ] as const satisfies readonly [
      MiddlewareHandler,
      MiddlewareHandler<{ Variables: JwtUserVariables }>,
    ];
  };

  return { jwtMiddleware, requirePermission, requireJwtUser, authorize };
};
