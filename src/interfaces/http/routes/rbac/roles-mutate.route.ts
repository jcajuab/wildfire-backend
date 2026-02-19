import { describeRoute, resolver } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { errorResponseSchema } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  createRoleSchema,
  roleIdParamSchema,
  updateRoleSchema,
} from "#/interfaces/http/validators/rbac.schema";
import {
  validateJson,
  validateParams,
} from "#/interfaces/http/validators/standard-validator";
import {
  type AuthorizePermission,
  type RbacRouter,
  type RbacRouterUseCases,
  roleTags,
} from "./shared";

export const registerRbacRoleMutateRoutes = (args: {
  router: RbacRouter;
  useCases: RbacRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = args;

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
        400: {
          description: "Invalid request",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        403: {
          description: "Forbidden",
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
        const role = await useCases.createRole.execute(payload);
        c.set("resourceId", role.id);
        return c.json(role, 201);
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
        const role = await useCases.updateRole.execute({
          id: params.id,
          ...payload,
        });
        return c.json(role);
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
        403: {
          description: "Forbidden (e.g. cannot delete system role)",
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
        await useCases.deleteRole.execute({
          id: params.id,
          callerUserId: c.get("userId"),
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
