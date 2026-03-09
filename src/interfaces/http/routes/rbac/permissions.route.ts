import { describeRoute } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { toApiListResponse, toApiResponse } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  forbiddenResponse,
  invalidRequestResponse,
  notFoundResponse,
  unauthorizedResponse,
  validationErrorResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import {
  permissionListQuerySchema,
  permissionOptionsQuerySchema,
  roleIdParamSchema,
  rolePermissionsListQuerySchema,
  setRolePermissionsSchema,
} from "#/interfaces/http/validators/rbac.schema";
import {
  validateJson,
  validateParams,
  validateQuery,
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
    validateQuery(rolePermissionsListQuerySchema),
    describeRoute({
      description: "Get role permissions",
      tags: roleTags,
      responses: {
        200: { description: "Permissions" },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
        422: {
          ...validationErrorResponse,
        },
        404: {
          ...notFoundResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const query = c.req.valid("query");
        const result = await useCases.getRolePermissions.execute({
          roleId: params.id,
          page: query.page,
          pageSize: query.pageSize,
        });
        return c.json(
          toApiListResponse({
            items: result.items,
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            requestUrl: c.req.url,
          }),
        );
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
          ...invalidRequestResponse,
        },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
        404: {
          ...notFoundResponse,
        },
        422: {
          ...validationErrorResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const payload = c.req.valid("json");
        c.set("rbacAssignmentCount", String(payload.permissionIds.length));
        const permissions = await useCases.setRolePermissions.execute({
          roleId: params.id,
          permissionIds: payload.permissionIds,
        });
        return c.json(toApiResponse(permissions));
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
    validateQuery(permissionListQuerySchema),
    describeRoute({
      description: "List permissions",
      tags: permissionTags,
      responses: {
        200: { description: "Permissions" },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
        422: {
          ...validationErrorResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const query = c.req.valid("query");
        const result = await useCases.listPermissions.execute({
          page: query.page,
          pageSize: query.pageSize,
          q: query.q,
        });
        return c.json(
          toApiListResponse({
            items: result.items,
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            requestUrl: c.req.url,
          }),
        );
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/permissions/options",
    setAction("rbac.permission.options", {
      route: "/permissions/options",
      resourceType: "permission",
    }),
    ...authorize("roles:read"),
    validateQuery(permissionOptionsQuerySchema),
    describeRoute({
      description: "List permission options",
      tags: permissionTags,
      responses: {
        200: { description: "Permission options" },
        401: { ...unauthorizedResponse },
        403: { ...forbiddenResponse },
        422: { ...validationErrorResponse },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const query = c.req.valid("query");
        const result = await useCases.listPermissionOptions.execute({
          q: query.q,
        });
        return c.json(toApiResponse(result));
      },
      ...applicationErrorMappers,
    ),
  );
};
