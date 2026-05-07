import { describeRoute } from "hono-openapi";
import {
  DuplicateEmailError,
  DuplicateUsernameError,
} from "#/application/use-cases/rbac/errors";
import {
  invalidateServerCache,
  jsonWithServerCache,
} from "#/interfaces/http/cache/server-cache";
import {
  addRoleSummariesToUsers,
  maybeEnrichUserForResponse,
  maybeEnrichUsersForResponse,
} from "#/interfaces/http/lib/user-response-enricher";
import { setAction } from "#/interfaces/http/middleware/observability";
import { conflict, toApiListResponse } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  mapErrorToResponse,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  authErrorResponses,
  authValidationErrorResponses,
  conflictResponse,
  invalidRequestResponse,
  notFoundResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import {
  createUserSchema,
  setUserRolesSchema,
  updateUserSchema,
  userIdParamSchema,
  userListQuerySchema,
  userOptionsQuerySchema,
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
  userTags,
} from "./shared";

export const registerRbacUserRoutes = (args: {
  router: RbacRouter;
  useCases: RbacRouterUseCases;
  deps: RbacRouterDeps;
  authorize: AuthorizePermission;
}) => {
  const { router, deps, useCases, authorize } = args;

  // --- resource CRUD ---

  router.get(
    "/users",
    setAction("rbac.user.list", { route: "/users", resourceType: "user" }),
    ...authorize("users:read"),
    validateQuery(userListQuerySchema),
    describeRoute({
      description: "List users",
      tags: userTags,
      responses: {
        200: { description: "Users" },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        return jsonWithServerCache(
          c,
          { domains: ["users", "roles"], ttl: "reference" },
          async () => {
            const query = c.req.valid("query");
            const result = await useCases.listUsers.execute({
              page: query.page,
              pageSize: query.pageSize,
              q: query.q,
              roleId: query.roleId,
              sortBy: query.sortBy,
              sortDirection: query.sortDirection,
            });
            const enrichedItems = await addRoleSummariesToUsers(
              result.items,
              deps,
            );
            return toApiListResponse({
              items: enrichedItems,
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
    "/users/options",
    setAction("rbac.user.options", {
      route: "/users/options",
      resourceType: "user",
    }),
    ...authorize("users:read"),
    validateQuery(userOptionsQuerySchema),
    describeRoute({
      description: "List user options",
      tags: userTags,
      responses: {
        200: { description: "User options" },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        return jsonWithServerCache(
          c,
          { domains: ["users"], ttl: "reference" },
          async () => {
            const query = c.req.valid("query");
            const users = await useCases.listUserOptions.execute({
              q: query.q,
              limit: query.limit,
            });
            const enriched = await maybeEnrichUsersForResponse(users, deps);
            const options = enriched.map((user) => ({
              id: user.id,
              username: user.username,
              email: user.email,
              name: user.name,
              ...(typeof user.avatarUrl === "string" &&
              user.avatarUrl.length > 0
                ? { avatarUrl: user.avatarUrl }
                : {}),
            }));
            return { data: options };
          },
        );
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/users",
    setAction("rbac.user.create", {
      route: "/users",
      resourceType: "user",
    }),
    ...authorize("users:create"),
    validateJson(createUserSchema),
    describeRoute({
      description: "Create user",
      tags: userTags,
      responses: {
        201: { description: "User created" },
        409: { ...conflictResponse },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const user = await useCases.createUser.execute(payload);
        c.set("resourceId", user.id);
        c.header("Location", `${c.req.path}/${encodeURIComponent(user.id)}`);
        await invalidateServerCache(["users", "roles", "permissions"]);
        return c.json({ data: user }, 201);
      },
      ...applicationErrorMappers,
      mapErrorToResponse(DuplicateEmailError, conflict),
      mapErrorToResponse(DuplicateUsernameError, conflict),
    ),
  );

  router.get(
    "/users/:id",
    setAction("rbac.user.get", {
      route: "/users/:id",
      resourceType: "user",
    }),
    ...authorize("users:read"),
    validateParams(userIdParamSchema),
    describeRoute({
      description: "Get user",
      tags: userTags,
      responses: {
        200: { description: "User" },
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
          { domains: ["users"], ttl: "reference" },
          async () => {
            const user = await useCases.getUser.execute({ id: params.id });
            const enriched = await maybeEnrichUserForResponse(user, deps);
            return { data: enriched };
          },
        );
      },
      ...applicationErrorMappers,
      mapErrorToResponse(DuplicateEmailError, conflict),
      mapErrorToResponse(DuplicateUsernameError, conflict),
    ),
  );

  router.patch(
    "/users/:id",
    setAction("rbac.user.update", {
      route: "/users/:id",
      resourceType: "user",
    }),
    ...authorize("users:update"),
    validateParams(userIdParamSchema),
    validateJson(updateUserSchema),
    describeRoute({
      description: "Update user",
      tags: userTags,
      responses: {
        200: { description: "User" },
        404: { ...notFoundResponse },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const payload = c.req.valid("json");
        const user = await useCases.updateUser.execute({
          id: params.id,
          ...payload,
          callerUserId: c.get("userId"),
        });
        await invalidateServerCache(["users", "roles", "permissions"]);
        return c.json({ data: user });
      },
      ...applicationErrorMappers,
    ),
  );

  router.delete(
    "/users/:id",
    setAction("rbac.user.delete", {
      route: "/users/:id",
      resourceType: "user",
    }),
    ...authorize("users:delete"),
    validateParams(userIdParamSchema),
    describeRoute({
      description: "Delete user",
      tags: userTags,
      responses: {
        204: { description: "Deleted" },
        404: { ...notFoundResponse },
        ...authErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        await useCases.deleteUser.execute({
          id: params.id,
          callerUserId: c.get("userId"),
        });
        await invalidateServerCache(["users", "roles", "permissions"]);
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  // --- user actions ---

  router.put(
    "/users/:id/status",
    setAction("rbac.user.status", {
      route: "/users/:id/status",
      resourceType: "user",
    }),
    ...authorize("users:update"),
    validateParams(userIdParamSchema),
    describeRoute({
      description: "Update user status (ban or unban)",
      tags: userTags,
      responses: {
        200: { description: "User status updated" },
        404: { ...notFoundResponse },
        ...authErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const body = await c.req.json<{ banned: boolean }>();
        if (body.banned) {
          await useCases.banUser.execute({
            id: params.id,
            callerUserId: c.get("userId"),
          });
        } else {
          await useCases.unbanUser.execute({
            id: params.id,
            callerUserId: c.get("userId"),
          });
        }
        await invalidateServerCache(["users", "roles", "permissions"]);
        return c.json({ data: { success: true } });
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/users/:id/reset-password",
    setAction("rbac.user.reset-password", {
      route: "/users/:id/reset-password",
      resourceType: "user",
    }),
    ...authorize("users:update"),
    validateParams(userIdParamSchema),
    describeRoute({
      description: "Admin reset password for an invited user",
      tags: userTags,
      responses: {
        200: { description: "Password reset; returns plaintext password" },
        404: { ...notFoundResponse },
        ...authErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const result = await useCases.adminResetPassword.execute({
          id: params.id,
          callerUserId: c.get("userId"),
        });
        await invalidateServerCache(["users"]);
        return c.json({ data: result });
      },
      ...applicationErrorMappers,
    ),
  );

  // --- user memberships (roles for a user) ---

  router.get(
    "/users/:id/roles",
    setAction("rbac.userRole.list", {
      route: "/users/:id/roles",
      resourceType: "user",
    }),
    ...authorize("users:read"),
    validateParams(userIdParamSchema),
    validateQuery(userListQuerySchema),
    describeRoute({
      description: "Get roles assigned to user",
      tags: userTags,
      responses: {
        200: { description: "Roles" },
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
          { domains: ["users", "roles"], ttl: "reference" },
          async () => {
            const result = await useCases.getUserRoles.execute({
              userId: params.id,
              page: query.page,
              pageSize: query.pageSize,
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

  router.put(
    "/users/:id/roles",
    setAction("rbac.userRole.set", {
      route: "/users/:id/roles",
      resourceType: "user",
    }),
    ...authorize("users:update"),
    validateParams(userIdParamSchema),
    validateJson(setUserRolesSchema),
    describeRoute({
      description: "Assign roles to user",
      tags: userTags,
      responses: {
        200: { description: "Roles assigned" },
        400: { ...invalidRequestResponse },
        404: { ...notFoundResponse },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const payload = c.req.valid("json");
        c.set("rbacAssignmentCount", String(payload.roleIds.length));
        const roles = await useCases.setUserRoles.execute({
          userId: params.id,
          roleIds: payload.roleIds,
        });
        await invalidateServerCache(["users", "roles", "permissions"]);
        return c.json({ data: roles });
      },
      ...applicationErrorMappers,
    ),
  );
};
