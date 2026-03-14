import { describeRoute } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { toApiListResponse, toApiResponse } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  authValidationErrorResponses,
  invalidRequestResponse,
  notFoundResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import {
  setUserRolesSchema,
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
  type RbacRouter,
  type RbacRouterUseCases,
  userTags,
} from "./shared";

export const registerRbacUserMembershipRoutes = (args: {
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
        const result = await useCases.getUserRoles.execute({
          userId: params.id,
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
        return c.json(toApiResponse(roles));
      },
      ...applicationErrorMappers,
    ),
  );
};
