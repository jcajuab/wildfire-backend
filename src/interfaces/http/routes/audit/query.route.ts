import { describeRoute, resolver } from "hono-openapi";
import { ValidationError } from "#/application/errors/validation";
import { setAction } from "#/interfaces/http/middleware/observability";
import { badRequest, errorResponseSchema } from "#/interfaces/http/responses";
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
        400: {
          description: "Invalid request",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
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
      const query = c.req.valid("query");
      try {
        const result = await useCases.listAuditEvents.execute(query);
        return c.json(result);
      } catch (error) {
        if (error instanceof ValidationError) {
          return badRequest(c, error.message);
        }
        throw error;
      }
    },
  );
};
