import { describeRoute } from "hono-openapi";
import {
  DuplicateEmailError,
  DuplicateUsernameError,
} from "#/application/use-cases/rbac/errors";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  conflict,
  toApiListResponse,
  toApiResponse,
} from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  mapErrorToResponse,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  authErrorResponses,
  authValidationErrorResponses,
  conflictResponse,
  notFoundResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import {
  createUserSchema,
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
  addRoleSummariesToUsers,
  maybeEnrichUserForResponse,
  maybeEnrichUsersForResponse,
  type RbacRouter,
  type RbacRouterDeps,
  type RbacRouterUseCases,
  userTags,
} from "./shared";

export const registerRbacUserResourceRoutes = (args: {
  router: RbacRouter;
  deps: RbacRouterDeps;
  useCases: RbacRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, deps, useCases, authorize } = args;

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
        const query = c.req.valid("query");
        const result = await useCases.listUsers.execute({
          page: query.page,
          pageSize: query.pageSize,
          q: query.q,
          sortBy: query.sortBy,
          sortDirection: query.sortDirection,
        });
        const enrichedItems = await addRoleSummariesToUsers(result.items, deps);
        return c.json(
          toApiListResponse({
            items: enrichedItems,
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
          ...(typeof user.avatarUrl === "string" && user.avatarUrl.length > 0
            ? { avatarUrl: user.avatarUrl }
            : {}),
        }));
        return c.json(toApiResponse(options));
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
        return c.json(toApiResponse(user), 201);
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
        const user = await useCases.getUser.execute({ id: params.id });
        const enriched = await maybeEnrichUserForResponse(user, deps);
        return c.json(toApiResponse(enriched));
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
        return c.json(toApiResponse(user));
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
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
