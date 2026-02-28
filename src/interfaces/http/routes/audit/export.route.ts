import { describeRoute, resolver } from "hono-openapi";
import { ValidationError } from "#/application/errors/validation";
import { type AuditEventRecord } from "#/application/ports/audit";
import { type DisplayRepository } from "#/application/ports/displays";
import { type UserRepository } from "#/application/ports/rbac";
import { ExportLimitExceededError } from "#/application/use-cases/audit";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  errorResponseSchema,
  validationError,
} from "#/interfaces/http/responses";
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
  "name",
  "resourceId",
  "resourceType",
  "ipAddress",
  "userAgent",
] as const;

const toCsvRow = (
  event: {
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
  },
  name: string,
) =>
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
    name,
    event.resourceId,
    event.resourceType,
    event.ipAddress,
    event.userAgent,
  ]
    .map(csvEscape)
    .join(",");

function getActorNameFallback(actorType: string | null): string {
  if (actorType === "display") return "Display";
  return "Unknown user";
}

async function warmActorNameCache(
  events: AuditEventRecord[],
  cache: Map<string, string>,
  userRepository: UserRepository,
  displayRepository: DisplayRepository,
): Promise<void> {
  const userIds = [
    ...new Set(
      events
        .filter((e) => e.actorType === "user" && e.actorId != null)
        .filter((e) => !cache.has(`user:${e.actorId as string}`))
        .map((e) => e.actorId as string),
    ),
  ];
  const displayIds = [
    ...new Set(
      events
        .filter((e) => e.actorType === "display" && e.actorId != null)
        .filter((e) => !cache.has(`display:${e.actorId as string}`))
        .map((e) => e.actorId as string),
    ),
  ];

  if (userIds.length === 0 && displayIds.length === 0) {
    return;
  }

  const [users, displays] = await Promise.all([
    userIds.length > 0
      ? userRepository.findByIds(userIds)
      : Promise.resolve([]),
    displayIds.length > 0
      ? displayRepository.findByIds(displayIds)
      : Promise.resolve([]),
  ]);

  for (const u of users) {
    cache.set(`user:${u.id}`, u.name);
  }
  for (const d of displays) {
    cache.set(`display:${d.id}`, d.name || d.identifier);
  }
}

function getActorName(
  event: AuditEventRecord,
  cache: Map<string, string>,
): string {
  const key =
    event.actorId != null && event.actorType != null
      ? `${event.actorType}:${event.actorId}`
      : null;
  if (key != null) {
    const resolved = cache.get(key);
    if (resolved != null) return resolved;
  }
  return getActorNameFallback(event.actorType);
}

const toExportFilename = (now: Date) => {
  const timestamp = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return `audit-events-${timestamp}.csv`;
};

export const registerAuditExportRoute = (args: {
  router: AuditRouter;
  useCases: AuditRouterUseCases;
  authorize: AuthorizePermission;
  repositories: {
    userRepository: UserRepository;
    displayRepository: DisplayRepository;
  };
}) => {
  const { router, useCases, authorize, repositories } = args;
  const { userRepository, displayRepository } = repositories;

  router.get(
    "/events/export",
    setAction("audit.event.download", {
      route: "/audit/events/export",
      resourceType: "audit-event",
    }),
    ...authorize("audit:download"),
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
        422: {
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
              const nameCache = new Map<string, string>();
              controller.enqueue(encoder.encode(`${CSV_HEADERS.join(",")}\n`));
              if (!firstChunk.done) {
                await warmActorNameCache(
                  firstChunk.value,
                  nameCache,
                  userRepository,
                  displayRepository,
                );
                for (const event of firstChunk.value) {
                  const name = getActorName(event, nameCache);
                  controller.enqueue(
                    encoder.encode(`${toCsvRow(event, name)}\n`),
                  );
                }
              }

              while (true) {
                const nextChunk = await iterator.next();
                if (nextChunk.done) break;
                await warmActorNameCache(
                  nextChunk.value,
                  nameCache,
                  userRepository,
                  displayRepository,
                );
                for (const event of nextChunk.value) {
                  const name = getActorName(event, nameCache);
                  controller.enqueue(
                    encoder.encode(`${toCsvRow(event, name)}\n`),
                  );
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
          return validationError(c, error.message);
        }
        if (error instanceof ValidationError) {
          return validationError(c, error.message);
        }
        throw error;
      }
    },
  );
};
