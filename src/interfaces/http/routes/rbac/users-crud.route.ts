import { describeRoute, resolver } from "hono-openapi";
import { DuplicateEmailError } from "#/application/use-cases/rbac/errors";
import { setAction } from "#/interfaces/http/middleware/observability";
import { conflict, errorResponseSchema } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  mapErrorToResponse,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  createUserSchema,
  updateUserSchema,
  userIdParamSchema,
} from "#/interfaces/http/validators/rbac.schema";
import {
  validateJson,
  validateParams,
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

export const registerRbacUserCrudRoutes = (args: {
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
    describeRoute({
      description: "List users",
      tags: userTags,
      responses: {
        200: { description: "Users" },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const page = Number(c.req.query("page")) || undefined;
        const pageSize = Number(c.req.query("pageSize")) || undefined;
        const result = await useCases.listUsers.execute({ page, pageSize });
        const enrichedItems = await maybeEnrichUsersForResponse(
          result.items,
          deps,
        );
        return c.json({
          items: enrichedItems,
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
        });
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
        422: {
          description: "Invalid request",
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
        422: {
          description: "Invalid request",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        403: {
          description: "Forbidden (e.g. cannot modify a Root user)",
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
        403: {
          description: "Forbidden (e.g. cannot delete a Root user)",
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
