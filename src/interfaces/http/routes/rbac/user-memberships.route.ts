import { describeRoute } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { badRequest } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  forbiddenResponse,
  invalidRequestResponse,
  notFoundResponse,
  unauthorizedResponse,
  validationErrorResponse,
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
        const result = await useCases.getUserRoles.execute({
          userId: params.id,
          page: query.page,
          pageSize: query.pageSize,
        });
        return c.json(result);
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
        400: {
          ...invalidRequestResponse,
        },
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
        if (
          payload.roleIds.length > 20 &&
          payload.policyVersion === undefined
        ) {
          return badRequest(
            c,
            "policyVersion is required when changing many role assignments at once.",
          );
        }
        if (payload.policyVersion !== undefined) {
          c.set("rbacPolicyVersion", String(payload.policyVersion));
        }
        c.set("rbacTargetCount", String(payload.roleIds.length));
        const roles = await useCases.setUserRoles.execute({
          userId: params.id,
          roleIds: payload.roleIds,
          policyVersion: payload.policyVersion,
          actorId: c.get("userId"),
          requestId: c.get("requestId"),
        });
        return c.json(roles);
      },
      ...applicationErrorMappers,
    ),
  );
};
