import { describeRoute, resolver } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import { authValidationErrorResponses } from "#/interfaces/http/routes/shared/openapi-responses";
import {
  auditLogFlushRequestBodySchema,
  auditLogFlushRequestSchema,
  auditLogFlushResponseSchema,
} from "#/interfaces/http/validators/audit.schema";
import { validateJson } from "#/interfaces/http/validators/standard-validator";
import {
  type AuditRouter,
  type AuditRouterUseCases,
  type AuthorizePermission,
  auditTags,
} from "./shared";

export const registerAuditFlushRoute = (args: {
  router: AuditRouter;
  useCases: AuditRouterUseCases;
  authorizeRead: AuthorizePermission;
  authorizeDelete: AuthorizePermission;
}) => {
  const { router, useCases, authorizeRead, authorizeDelete } = args;
  const [, requireAuditDelete] = authorizeDelete("audit:delete");

  router.delete(
    "/events",
    setAction("audit.event.flush", {
      route: "/audit/events",
      resourceType: "audit-log",
    }),
    ...authorizeRead("audit:read"),
    requireAuditDelete,
    validateJson(auditLogFlushRequestSchema),
    describeRoute({
      description: "Flush audit events",
      tags: auditTags,
      requestBody: {
        content: {
          "application/json": {
            schema: auditLogFlushRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        200: {
          description: "Audit events flushed",
          content: {
            "application/json": {
              schema: resolver(auditLogFlushResponseSchema),
            },
          },
        },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const result = await useCases.flushAuditLogs.execute(payload);
        c.set("resourceId", payload.mode);
        c.set("resourceType", "audit-log");
        return c.json({ data: result });
      },
      ...applicationErrorMappers,
    ),
  );
};
