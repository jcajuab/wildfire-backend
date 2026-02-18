import { describeRoute, resolver } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { errorResponseSchema } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
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
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const page = Number(c.req.query("page")) || undefined;
        const pageSize = Number(c.req.query("pageSize")) || undefined;
        c.set("resourceId", params.id);
        const result = await useCases.getUserRoles.execute({
          userId: params.id,
          page,
          pageSize,
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
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const payload = c.req.valid("json");
        if (
          payload.roleIds.length > 20 &&
          payload.policyVersion === undefined
        ) {
          return c.json(
            {
              error: {
                code: "INVALID_REQUEST",
                message:
                  "policyVersion is required when changing many role assignments at once.",
              },
            },
            400,
          );
        }
        if (payload.policyVersion !== undefined) {
          c.set("rbacPolicyVersion", String(payload.policyVersion));
        }
        c.set("rbacTargetCount", String(payload.roleIds.length));
        const roles = await useCases.setUserRoles.execute({
          userId: params.id,
          roleIds: payload.roleIds,
        });
        return c.json(roles);
      },
      ...applicationErrorMappers,
    ),
  );
};
