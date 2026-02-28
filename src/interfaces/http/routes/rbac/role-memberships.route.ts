import { describeRoute } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { toApiListResponse } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  forbiddenResponse,
  notFoundResponse,
  unauthorizedResponse,
  validationErrorResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import {
  roleIdParamSchema,
  userListQuerySchema,
} from "#/interfaces/http/validators/rbac.schema";
import {
  validateParams,
  validateQuery,
} from "#/interfaces/http/validators/standard-validator";
import {
  type AuthorizePermission,
  maybeEnrichUsersForResponse,
  type RbacRouter,
  type RbacRouterDeps,
  type RbacRouterUseCases,
  roleTags,
} from "./shared";

export const registerRbacRoleMembershipRoutes = (args: {
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
    validateQuery(userListQuerySchema),
    describeRoute({
      description: "Get users assigned to role",
      tags: roleTags,
      responses: {
        200: { description: "Users" },
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
        const query = c.req.valid("query");
        c.set("resourceId", params.id);
        const result = await useCases.getRoleUsers.execute({
          roleId: params.id,
          page: query.page,
          pageSize: query.pageSize,
        });
        const enriched = await maybeEnrichUsersForResponse(result.items, deps);
        return c.json(
          toApiListResponse({
            items: enriched,
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
};
