import { describeRoute } from "hono-openapi";
import { DuplicateEmailError } from "#/application/use-cases/rbac/errors";
import { setAction } from "#/interfaces/http/middleware/observability";
import { conflict, toApiListResponse } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  mapErrorToResponse,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  conflictResponse,
  forbiddenResponse,
  notFoundResponse,
  unauthorizedResponse,
  validationErrorResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import {
  createUserSchema,
  updateUserSchema,
  userIdParamSchema,
  userListQuerySchema,
} from "#/interfaces/http/validators/rbac.schema";
import {
  validateJson,
  validateParams,
  validateQuery,
} from "#/interfaces/http/validators/standard-validator";
import {
  type AuthorizePermission,
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
        const result = await useCases.listUsers.execute({
          page: query.page,
          pageSize: query.pageSize,
        });
        const enrichedItems = await maybeEnrichUsersForResponse(
          result.items,
          deps,
        );
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
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
        409: {
          ...conflictResponse,
        },
        422: {
          ...validationErrorResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const user = await useCases.createUser.execute(payload);
        c.set("resourceId", user.id);
        return c.json(user, 201);
      },
      mapErrorToResponse(DuplicateEmailError, conflict),
      ...applicationErrorMappers,
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
        const user = await useCases.getUser.execute({ id: params.id });
        const enriched = await maybeEnrichUserForResponse(user, deps);
        return c.json(enriched);
      },
      ...applicationErrorMappers,
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
        const user = await useCases.updateUser.execute({
          id: params.id,
          ...payload,
          callerUserId: c.get("userId"),
        });
        return c.json(user);
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
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
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
