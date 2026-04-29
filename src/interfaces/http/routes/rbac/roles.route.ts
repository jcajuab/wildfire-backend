import { describeRoute } from "hono-openapi";
import { logger } from "#/infrastructure/observability/logger";
import {
  invalidateServerCache,
  jsonWithServerCache,
} from "#/interfaces/http/cache/server-cache";
import { maybeEnrichUsersForResponse } from "#/interfaces/http/lib/user-response-enricher";
import { setAction } from "#/interfaces/http/middleware/observability";
import { toApiListResponse } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  authValidationErrorResponses,
  notFoundResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import {
  createRoleSchema,
  roleIdParamSchema,
  roleListQuerySchema,
  roleOptionsQuerySchema,
  updateRoleSchema,
  userListQuerySchema,
} from "#/interfaces/http/validators/rbac.schema";
import {
  validateJson,
  validateParams,
  validateQuery,
} from "#/interfaces/http/validators/standard-validator";
import {
  type AuthorizePermission,
  type RbacRouter,
  type RbacRouterDeps,
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

export const registerRbacRoleRoutes = (args: {
  router: RbacRouter;
  deps: RbacRouterDeps;
  useCases: RbacRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, deps, useCases, authorize } = args;

  // --- bootstrap ---

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
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        return jsonWithServerCache(
          c,
          {
            domains: ["roles", "permissions", "users"],
            ttl: "reference",
            varyByPermissions: true,
          },
          async () => {
            const startedAt = Date.now();
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

            return {
              data: {
                role,
                permissions,
                rolePermissions: rolePermissions.items,
                roleUsers: roleUsers.items,
              },
            };
          },
        );
      },
      ...applicationErrorMappers,
    ),
  );

  // --- read ---

  router.get(
    "/roles",
    setAction("rbac.role.list", { route: "/roles", resourceType: "role" }),
    ...authorize("roles:read"),
    validateQuery(roleListQuerySchema),
    describeRoute({
      description: "List roles",
      tags: roleTags,
      responses: {
        200: { description: "Roles" },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        return jsonWithServerCache(
          c,
          { domains: ["roles"], ttl: "reference" },
          async () => {
            const query = c.req.valid("query");
            const result = await useCases.listRoles.execute({
              page: query.page,
              pageSize: query.pageSize,
              q: query.q,
              sortBy: query.sortBy,
              sortDirection: query.sortDirection,
            });
            return toApiListResponse({
              items: result.items,
              total: result.total,
              page: result.page,
              pageSize: result.pageSize,
              requestUrl: c.req.url,
            });
          },
        );
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/roles/options",
    setAction("rbac.role.options", {
      route: "/roles/options",
      resourceType: "role",
    }),
    ...authorize("roles:read"),
    validateQuery(roleOptionsQuerySchema),
    describeRoute({
      description: "List role options",
      tags: roleTags,
      responses: {
        200: { description: "Role options" },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        return jsonWithServerCache(
          c,
          { domains: ["roles"], ttl: "reference" },
          async () => {
            const query = c.req.valid("query");
            const result = await useCases.listRoleOptions.execute({
              q: query.q,
              limit: query.limit,
            });
            return { data: result };
          },
        );
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/roles/:id",
    setAction("rbac.role.get", {
      route: "/roles/:id",
      resourceType: "role",
    }),
    ...authorize("roles:read"),
    validateParams(roleIdParamSchema),
    describeRoute({
      description: "Get role",
      tags: roleTags,
      responses: {
        200: { description: "Role" },
        404: { ...notFoundResponse },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        return jsonWithServerCache(
          c,
          { domains: ["roles"], ttl: "reference" },
          async () => {
            const role = await useCases.getRole.execute({ id: params.id });
            return { data: role };
          },
        );
      },
      ...applicationErrorMappers,
    ),
  );

  // --- write ---

  router.post(
    "/roles",
    setAction("rbac.role.create", { route: "/roles", resourceType: "role" }),
    ...authorize("roles:create"),
    validateJson(createRoleSchema),
    describeRoute({
      description: "Create role",
      tags: roleTags,
      responses: {
        201: { description: "Role created" },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const role = await useCases.createRole.execute(payload);
        c.set("resourceId", role.id);
        c.header("Location", `${c.req.path}/${encodeURIComponent(role.id)}`);
        await invalidateServerCache(["roles", "permissions", "users"]);
        return c.json({ data: role }, 201);
      },
      ...applicationErrorMappers,
    ),
  );

  router.patch(
    "/roles/:id",
    setAction("rbac.role.update", {
      route: "/roles/:id",
      resourceType: "role",
    }),
    ...authorize("roles:update"),
    validateParams(roleIdParamSchema),
    validateJson(updateRoleSchema),
    describeRoute({
      description: "Update role",
      tags: roleTags,
      responses: {
        200: { description: "Role" },
        404: { ...notFoundResponse },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const payload = c.req.valid("json");
        const role = await useCases.updateRole.execute({
          id: params.id,
          ...payload,
        });
        await invalidateServerCache(["roles", "permissions", "users"]);
        return c.json({ data: role });
      },
      ...applicationErrorMappers,
    ),
  );

  router.delete(
    "/roles/:id",
    setAction("rbac.role.delete", {
      route: "/roles/:id",
      resourceType: "role",
    }),
    ...authorize("roles:delete"),
    validateParams(roleIdParamSchema),
    describeRoute({
      description: "Delete role",
      tags: roleTags,
      responses: {
        204: { description: "Deleted" },
        404: { ...notFoundResponse },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        await useCases.deleteRole.execute({
          id: params.id,
          callerUserId: c.get("userId"),
        });
        await invalidateServerCache(["roles", "permissions", "users"]);
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  // --- role memberships (users in a role) ---

  router.get(
    "/roles/:id/users",
    setAction("rbac.roleUser.list", {
      route: "/roles/:id/users",
      resourceType: "role",
    }),
    ...authorize("roles:read"),
    validateParams(roleIdParamSchema),
    validateQuery(userListQuerySchema),
    describeRoute({
      description: "Get users assigned to role",
      tags: roleTags,
      responses: {
        200: { description: "Users" },
        404: { ...notFoundResponse },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const query = c.req.valid("query");
        c.set("resourceId", params.id);
        return jsonWithServerCache(
          c,
          { domains: ["roles", "users"], ttl: "reference" },
          async () => {
            const result = await useCases.getRoleUsers.execute({
              roleId: params.id,
              page: query.page,
              pageSize: query.pageSize,
            });
            const enriched = await maybeEnrichUsersForResponse(
              result.items,
              deps,
            );
            return toApiListResponse({
              items: enriched,
              total: result.total,
              page: result.page,
              pageSize: result.pageSize,
              requestUrl: c.req.url,
            });
          },
        );
      },
      ...applicationErrorMappers,
    ),
  );
};
