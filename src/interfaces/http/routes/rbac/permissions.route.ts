import { describeRoute, resolver } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { errorResponseSchema } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  roleIdParamSchema,
  setRolePermissionsSchema,
} from "#/interfaces/http/validators/rbac.schema";
import {
  validateJson,
  validateParams,
} from "#/interfaces/http/validators/standard-validator";
import {
  type AuthorizePermission,
  permissionTags,
  type RbacRouter,
  type RbacRouterUseCases,
  roleTags,
} from "./shared";

export const registerRbacPermissionRoutes = (args: {
  router: RbacRouter;
  useCases: RbacRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = args;

  router.get(
    "/roles/:id/permissions",
    setAction("rbac.rolePermission.list", {
      route: "/roles/:id/permissions",
      resourceType: "role",
    }),
    ...authorize("roles:read"),
    validateParams(roleIdParamSchema),
    describeRoute({
      description: "Get role permissions",
      tags: roleTags,
      responses: {
        200: { description: "Permissions" },
        404: {
          description: "Not found",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const permissions = await useCases.getRolePermissions.execute({
          roleId: params.id,
        });
        return c.json(permissions);
      },
      ...applicationErrorMappers,
    ),
  );

  router.put(
    "/roles/:id/permissions",
    setAction("rbac.rolePermission.set", {
      route: "/roles/:id/permissions",
      resourceType: "role",
    }),
    ...authorize("roles:update"),
    validateParams(roleIdParamSchema),
    validateJson(setRolePermissionsSchema),
    describeRoute({
      description: "Set role permissions",
      tags: roleTags,
      responses: {
        200: { description: "Permissions updated" },
        400: {
          description: "Invalid request",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        403: {
          description: "Forbidden (e.g. cannot modify system role)",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        404: {
          description: "Not found",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const payload = c.req.valid("json");
        const permissions = await useCases.setRolePermissions.execute({
          roleId: params.id,
          permissionIds: payload.permissionIds,
        });
        return c.json(permissions);
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/permissions",
    setAction("rbac.permission.list", {
      route: "/permissions",
      resourceType: "permission",
    }),
    ...authorize("roles:read"),
    describeRoute({
      description: "List permissions",
      tags: permissionTags,
      responses: {
        200: { description: "Permissions" },
      },
    }),
    async (c) => {
      const permissions = await useCases.listPermissions.execute();
      return c.json(permissions);
    },
  );
};
