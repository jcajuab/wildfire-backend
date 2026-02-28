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
  roleListQuerySchema,
} from "#/interfaces/http/validators/rbac.schema";
import {
  validateParams,
  validateQuery,
} from "#/interfaces/http/validators/standard-validator";
import {
  type AuthorizePermission,
  type RbacRouter,
  type RbacRouterUseCases,
  roleTags,
} from "./shared";

export const registerRbacRoleReadRoutes = (args: {
  router: RbacRouter;
  useCases: RbacRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = args;

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
        const result = await useCases.listRoles.execute({
          page: query.page,
          pageSize: query.pageSize,
        });
        return c.json(
          toApiListResponse({
            items: result.items,
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
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
        422: {
          ...validationErrorResponse,
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
        const role = await useCases.getRole.execute({ id: params.id });
        return c.json(role);
      },
      ...applicationErrorMappers,
    ),
  );
};
