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
        const page = Number(c.req.query("page")) || undefined;
        const pageSize = Number(c.req.query("pageSize")) || undefined;
        c.set("resourceId", params.id);
        const result = await useCases.getRolePermissions.execute({
          roleId: params.id,
          page,
          pageSize,
        });
        return c.json(result);
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
        if (
          payload.permissionIds.length > 20 &&
          payload.policyVersion === undefined
        ) {
          return c.json(
            {
              error: {
                code: "INVALID_REQUEST",
                message:
                  "policyVersion is required when changing many permissions at once.",
              },
            },
            400,
          );
        }
        if (payload.policyVersion !== undefined) {
          c.set("rbacPolicyVersion", String(payload.policyVersion));
        }
        c.set("rbacTargetCount", String(payload.permissionIds.length));
        const permissions = await useCases.setRolePermissions.execute({
          roleId: params.id,
          permissionIds: payload.permissionIds,
          policyVersion: payload.policyVersion,
          actorId: c.get("userId"),
          requestId: c.get("requestId"),
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
    withRouteErrorHandling(
      async (c) => {
        const page = Number(c.req.query("page")) || undefined;
        const pageSize = Number(c.req.query("pageSize")) || undefined;
        const result = await useCases.listPermissions.execute({
          page,
          pageSize,
        });
        return c.json(result);
      },
      ...applicationErrorMappers,
    ),
  );
};
