import { describeRoute, resolver } from "hono-openapi";
import { ValidationError } from "#/application/errors/validation";
import { ExportLimitExceededError } from "#/application/use-cases/audit";
import { setAction } from "#/interfaces/http/middleware/observability";
import { badRequest, errorResponseSchema } from "#/interfaces/http/responses";
import {
  auditEventExportQuerySchema,
  auditEventSchema,
} from "#/interfaces/http/validators/audit.schema";
import { validateQuery } from "#/interfaces/http/validators/standard-validator";
import {
  type AuditRouter,
  type AuditRouterUseCases,
  type AuthorizePermission,
  auditTags,
} from "./shared";

const DANGEROUS_CSV_PREFIX = /^[=+\-@]|^[\t\r\n]|^[ ]+[=+\-@]/;

const csvEscape = (value: string | number | null) => {
  if (value == null) {
    return "";
  }

  const raw = String(value);
  const normalized = DANGEROUS_CSV_PREFIX.test(raw) ? `'${raw}` : raw;
  const escaped = normalized.replaceAll('"', '""');
  return `"${escaped}"`;
};

const CSV_HEADERS = [
  "occurredAt",
  "requestId",
  "action",
  "route",
  "method",
  "path",
  "status",
  "actorId",
  "actorType",
  "resourceId",
  "resourceType",
  "ipAddress",
  "userAgent",
] as const;

const toCsvRow = (event: {
  occurredAt: string;
  requestId: string | null;
  action: string;
  route: string | null;
  method: string;
  path: string;
  status: number;
  actorId: string | null;
  actorType: string | null;
  resourceId: string | null;
  resourceType: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}) =>
  [
    event.occurredAt,
    event.requestId,
    event.action,
    event.route,
    event.method,
    event.path,
    event.status,
    event.actorId,
    event.actorType,
    event.resourceId,
    event.resourceType,
    event.ipAddress,
    event.userAgent,
  ]
    .map(csvEscape)
    .join(",");

const toExportFilename = (now: Date) => {
  const timestamp = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return `audit-events-${timestamp}.csv`;
};

export const registerAuditExportRoute = (args: {
  router: AuditRouter;
  useCases: AuditRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = args;

  router.get(
    "/events/export",
    setAction("audit.event.export", {
      route: "/audit/events/export",
      resourceType: "audit-event",
    }),
    ...authorize("audit:export"),
    validateQuery(auditEventExportQuerySchema),
    describeRoute({
      description: "Export audit events as CSV",
      tags: auditTags,
      responses: {
        200: {
          description: "Audit event CSV export",
          content: {
            "text/csv": {
              schema: resolver(auditEventSchema.array()),
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
      const iterator = useCases.exportAuditEvents
        .execute(query)
        [Symbol.asyncIterator]();

      try {
        const firstChunk = await iterator.next();
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              controller.enqueue(encoder.encode(`${CSV_HEADERS.join(",")}\n`));
              if (!firstChunk.done) {
                for (const event of firstChunk.value) {
                  controller.enqueue(encoder.encode(`${toCsvRow(event)}\n`));
                }
              }

              while (true) {
                const nextChunk = await iterator.next();
                if (nextChunk.done) break;
                for (const event of nextChunk.value) {
                  controller.enqueue(encoder.encode(`${toCsvRow(event)}\n`));
                }
              }

              controller.close();
            } catch (error) {
              controller.error(error);
            } finally {
              await iterator.return?.();
            }
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${toExportFilename(
              new Date(),
            )}"`,
          },
        });
      } catch (error) {
        if (error instanceof ExportLimitExceededError) {
          return badRequest(c, error.message);
        }
        if (error instanceof ValidationError) {
          return badRequest(c, error.message);
        }
        throw error;
      }
    },
  );
};
