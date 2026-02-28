import { describeRoute, resolver } from "hono-openapi";
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
  createRoleDeletionRequestSchema,
  rejectRoleDeletionRequestSchema,
  roleDeletionRequestIdParamSchema,
  roleDeletionRequestListQuerySchema,
  roleDeletionRequestListResponseSchema,
  roleIdParamSchema,
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
  roleTags,
} from "./shared";

export const registerRbacRoleDeletionRequestRoutes = (args: {
  router: RbacRouter;
  useCases: RbacRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = args;

  router.post(
    "/roles/:id/deletion-requests",
    setAction("rbac.roleDeletion.request", {
      route: "/roles/:id/deletion-requests",
      resourceType: "role-deletion-request",
    }),
    ...authorize("roles:delete"),
    validateParams(roleIdParamSchema),
    validateJson(createRoleDeletionRequestSchema),
    describeRoute({
      description: "Create a role deletion request",
      tags: roleTags,
      responses: {
        204: { description: "Request created" },
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
        const payload = c.req.valid("json");
        c.set("resourceId", params.id);
        await useCases.createRoleDeletionRequest.execute({
          roleId: params.id,
          requestedByUserId: c.get("userId"),
          reason: payload.reason,
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/roles/deletion-requests",
    setAction("rbac.roleDeletion.list", {
      route: "/roles/deletion-requests",
      resourceType: "role-deletion-request",
    }),
    ...authorize("roles:delete"),
    validateQuery(roleDeletionRequestListQuerySchema),
    describeRoute({
      description: "List role deletion requests",
      tags: roleTags,
      responses: {
        200: {
          description: "Role deletion requests",
          content: {
            "application/json": {
              schema: resolver(roleDeletionRequestListResponseSchema),
            },
          },
        },
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
        const result = await useCases.listRoleDeletionRequests.execute(query);
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

  router.post(
    "/roles/deletion-requests/:id/approve",
    setAction("rbac.roleDeletion.approve", {
      route: "/roles/deletion-requests/:id/approve",
      resourceType: "role-deletion-request",
    }),
    ...authorize("roles:delete"),
    validateParams(roleDeletionRequestIdParamSchema),
    describeRoute({
      description: "Approve a role deletion request",
      tags: roleTags,
      responses: {
        204: { description: "Approved" },
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
        await useCases.approveRoleDeletionRequest.execute({
          requestId: params.id,
          approvedByUserId: c.get("userId"),
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/roles/deletion-requests/:id/reject",
    setAction("rbac.roleDeletion.reject", {
      route: "/roles/deletion-requests/:id/reject",
      resourceType: "role-deletion-request",
    }),
    ...authorize("roles:delete"),
    validateParams(roleDeletionRequestIdParamSchema),
    validateJson(rejectRoleDeletionRequestSchema),
    describeRoute({
      description: "Reject a role deletion request",
      tags: roleTags,
      responses: {
        204: { description: "Rejected" },
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
        const payload = c.req.valid("json");
        c.set("resourceId", params.id);
        await useCases.rejectRoleDeletionRequest.execute({
          requestId: params.id,
          approvedByUserId: c.get("userId"),
          reason: payload.reason,
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
