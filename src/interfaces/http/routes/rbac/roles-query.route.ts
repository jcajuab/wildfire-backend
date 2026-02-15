import { describeRoute, resolver } from "hono-openapi";
import { NotFoundError } from "#/application/use-cases/rbac";
import { setAction } from "#/interfaces/http/middleware/observability";
import { errorResponseSchema, notFound } from "#/interfaces/http/responses";
import { roleIdParamSchema } from "#/interfaces/http/validators/rbac.schema";
import { validateParams } from "#/interfaces/http/validators/standard-validator";
import {
  type AuthorizePermission,
  type RbacRouter,
  type RbacRouterUseCases,
  roleTags,
} from "./shared";

export const registerRbacRoleQueryRoutes = (args: {
  router: RbacRouter;
  useCases: RbacRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = args;

  router.get(
    "/roles",
    setAction("rbac.role.list", { route: "/roles", resourceType: "role" }),
    ...authorize("roles:read"),
    describeRoute({
      description: "List roles",
      tags: roleTags,
      responses: {
        200: { description: "Roles" },
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
    async (c) => {
      const roles = await useCases.listRoles.execute();
      return c.json(roles);
    },
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
        const role = await useCases.getRole.execute({ id: params.id });
        return c.json(role);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );
};
