import { describeRoute, resolver } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { errorResponseSchema } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import { roleIdParamSchema } from "#/interfaces/http/validators/rbac.schema";
import { validateParams } from "#/interfaces/http/validators/standard-validator";
import {
  type AuthorizePermission,
  maybeEnrichUsersForResponse,
  type RbacRouter,
  type RbacRouterDeps,
  type RbacRouterUseCases,
  roleTags,
} from "./shared";

export const registerRbacRoleUserRoutes = (args: {
  router: RbacRouter;
  deps: RbacRouterDeps;
  useCases: RbacRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, deps, useCases, authorize } = args;

  router.get(
    "/roles/:id/users",
    setAction("rbac.roleUser.list", {
      route: "/roles/:id/users",
      resourceType: "role",
    }),
    ...authorize("roles:read"),
    validateParams(roleIdParamSchema),
    describeRoute({
      description: "Get users assigned to role",
      tags: roleTags,
      responses: {
        200: { description: "Users" },
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
        const users = await useCases.getRoleUsers.execute({
          roleId: params.id,
        });
        const enriched = await maybeEnrichUsersForResponse(users, deps);
        return c.json(enriched);
      },
      ...applicationErrorMappers,
    ),
  );
};
