import { describeRoute } from "hono-openapi";
import { logger } from "#/infrastructure/observability/logger";
import { setAction } from "#/interfaces/http/middleware/observability";
import { toApiResponse } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  authValidationErrorResponses,
  notFoundResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import { roleIdParamSchema } from "#/interfaces/http/validators/rbac.schema";
import { validateParams } from "#/interfaces/http/validators/standard-validator";
import {
  type AuthorizePermission,
  type RbacRouter,
  type RbacRouterUseCases,
  roleTags,
} from "./shared";

const hasPermission = (
  c: { get: (name: string) => unknown },
  permission: string,
): boolean => {
  const payload = c.get("jwtPayload") as
    | { isAdmin?: boolean; permissions?: string[] }
    | undefined;
  return (
    payload?.isAdmin === true ||
    payload?.permissions?.includes(permission) === true
  );
};

export const registerRbacRoleBootstrapRoute = (args: {
  router: RbacRouter;
  useCases: RbacRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = args;

  router.get(
    "/roles/:id/bootstrap",
    setAction("rbac.role.bootstrap", {
      route: "/roles/:id/bootstrap",
      resourceType: "role",
    }),
    ...authorize("roles:read"),
    validateParams(roleIdParamSchema),
    describeRoute({
      description: "Get role edit page bootstrap data",
      tags: roleTags,
      responses: {
        200: { description: "Role edit bootstrap" },
        404: { ...notFoundResponse },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const startedAt = Date.now();
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const canReadUsers = hasPermission(c, "users:read");

        const [role, permissions, rolePermissions, roleUsers] =
          await Promise.all([
            useCases.getRole.execute({ id: params.id }),
            useCases.listPermissionOptions.execute(),
            useCases.getRolePermissions.execute({
              roleId: params.id,
              page: 1,
              pageSize: 1000,
            }),
            canReadUsers
              ? useCases.getRoleUsers.execute({
                  roleId: params.id,
                  page: 1,
                  pageSize: 1000,
                })
              : Promise.resolve({
                  items: [],
                  total: 0,
                  page: 1,
                  pageSize: 1000,
                }),
          ]);

        logger.info(
          {
            event: "http.bootstrap.role_edit.completed",
            durationMs: Date.now() - startedAt,
            permissionCount: permissions.length,
            roleUserCount: roleUsers.items.length,
          },
          "Role edit bootstrap completed",
        );

        return c.json(
          toApiResponse({
            role,
            permissions,
            rolePermissions: rolePermissions.items,
            roleUsers: roleUsers.items,
          }),
        );
      },
      ...applicationErrorMappers,
    ),
  );
};
