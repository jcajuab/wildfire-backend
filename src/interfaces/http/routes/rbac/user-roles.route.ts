import { describeRoute, resolver } from "hono-openapi";
import { ForbiddenError } from "#/application/errors/forbidden";
import { NotFoundError } from "#/application/use-cases/rbac";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  errorResponseSchema,
  forbidden,
  notFound,
} from "#/interfaces/http/responses";
import {
  setUserRolesSchema,
  userIdParamSchema,
} from "#/interfaces/http/validators/rbac.schema";
import {
  validateJson,
  validateParams,
} from "#/interfaces/http/validators/standard-validator";
import {
  type AuthorizePermission,
  type RbacRouter,
  type RbacRouterUseCases,
  userTags,
} from "./shared";

export const registerRbacUserRoleRoutes = (args: {
  router: RbacRouter;
  useCases: RbacRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = args;

  router.get(
    "/users/:id/roles",
    setAction("rbac.userRole.list", {
      route: "/users/:id/roles",
      resourceType: "user",
    }),
    ...authorize("users:read"),
    validateParams(userIdParamSchema),
    describeRoute({
      description: "Get roles assigned to user",
      tags: userTags,
      responses: {
        200: { description: "Roles" },
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
    async (c) => {
      const params = c.req.valid("param");
      c.set("resourceId", params.id);
      try {
        const roles = await useCases.getUserRoles.execute({
          userId: params.id,
        });
        return c.json(roles);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
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
        400: {
          description: "Invalid request",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        403: {
          description:
            "Forbidden (e.g. cannot assign or remove Super Admin role)",
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
    async (c) => {
      const params = c.req.valid("param");
      c.set("resourceId", params.id);
      const payload = c.req.valid("json");
      try {
        const roles = await useCases.setUserRoles.execute({
          userId: params.id,
          roleIds: payload.roleIds,
        });
        return c.json(roles);
      } catch (error) {
        if (error instanceof ForbiddenError) {
          return forbidden(c, error.message);
        }
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );
};
