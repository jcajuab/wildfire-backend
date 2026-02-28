import { describeRoute, resolver } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { toApiListResponse } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  forbiddenResponse,
  unauthorizedResponse,
  validationErrorResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import {
  auditEventListQuerySchema,
  auditEventListResponseSchema,
} from "#/interfaces/http/validators/audit.schema";
import { validateQuery } from "#/interfaces/http/validators/standard-validator";
import {
  type AuditRouter,
  type AuditRouterUseCases,
  type AuthorizePermission,
  auditTags,
} from "./shared";

export const registerAuditQueryRoutes = (args: {
  router: AuditRouter;
  useCases: AuditRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = args;

  router.get(
    "/events",
    setAction("audit.event.list", {
      route: "/audit/events",
      resourceType: "audit-event",
    }),
    ...authorize("audit:read"),
    validateQuery(auditEventListQuerySchema),
    describeRoute({
      description: "List audit events",
      tags: auditTags,
      responses: {
        200: {
          description: "Audit events",
          content: {
            "application/json": {
              schema: resolver(auditEventListResponseSchema),
            },
          },
        },
        422: {
          ...validationErrorResponse,
        },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const query = c.req.valid("query");
        const result = await useCases.listAuditEvents.execute(query);
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
};
