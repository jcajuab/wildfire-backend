import { describeRoute, resolver } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { apiResponseSchema, toApiResponse } from "#/interfaces/http/responses";
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
  contentJobIdParamSchema,
  contentJobSchema,
} from "#/interfaces/http/validators/content.schema";
import { validateParams } from "#/interfaces/http/validators/standard-validator";
import { subscribeToContentJobEvents } from "./jobs-stream";
import {
  type ContentRouter,
  type ContentRouterUseCases,
  contentTags,
  type RequirePermission,
} from "./shared";

const STREAM_HEARTBEAT_INTERVAL_MS = 15_000;

const closeStreamController = (
  streamController: ReadableStreamDefaultController<Uint8Array> | null,
): void => {
  if (!streamController) {
    return;
  }
  try {
    streamController.close();
  } catch {
    // Ignore repeated close attempts after stream teardown.
  }
};

export const registerContentJobRoutes = (args: {
  router: ContentRouter;
  useCases: ContentRouterUseCases;
  requirePermission: RequirePermission;
}) => {
  const { router, useCases, requirePermission } = args;

  router.get(
    "/:id",
    setAction("content.jobs.get", {
      route: "/content-jobs/:id",
      resourceType: "content",
    }),
    requirePermission("content:read"),
    validateParams(contentJobIdParamSchema),
    describeRoute({
      description: "Get content ingestion job details",
      tags: contentTags,
      responses: {
        200: {
          description: "Content ingestion job details",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(contentJobSchema)),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const result = await useCases.getContentJob.execute({ id: params.id });
        return c.json(toApiResponse(result), 200);
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/:id/events",
    setAction("content.jobs.events", {
      route: "/content-jobs/:id/events",
      resourceType: "content",
    }),
    requirePermission("content:read"),
    validateParams(contentJobIdParamSchema),
    describeRoute({
      description: "Stream content ingestion job events via SSE",
      tags: contentTags,
      responses: {
        200: {
          description: "Server-sent events stream for a content job",
          content: {
            "text/event-stream": {
              schema: {
                type: "string",
              },
            },
          },
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
        const job = await useCases.getContentJob.execute({ id: params.id });

        const encoder = new TextEncoder();
        let unsubscribe: (() => void) | null = null;
        let heartbeat: ReturnType<typeof setInterval> | null = null;
        let isClosed = false;
        let streamController: ReadableStreamDefaultController<Uint8Array> | null =
          null;

        const safeEnqueue = (frame: string): void => {
          if (isClosed) {
            return;
          }
          if (!streamController) {
            return;
          }
          try {
            streamController.enqueue(encoder.encode(frame));
          } catch {
            isClosed = true;
            if (unsubscribe) {
              unsubscribe();
              unsubscribe = null;
            }
            if (heartbeat) {
              clearInterval(heartbeat);
              heartbeat = null;
            }
            closeStreamController(streamController);
          }
        };

        const closeStream = (): void => {
          if (isClosed) {
            return;
          }
          isClosed = true;
          if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
          }
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
        };

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
            safeEnqueue(
              `event: connected\ndata: ${JSON.stringify({ jobId: job.id, timestamp: new Date().toISOString() })}\n\n`,
            );
            safeEnqueue(`event: snapshot\ndata: ${JSON.stringify(job)}\n\n`);

            if (job.status === "SUCCEEDED" || job.status === "FAILED") {
              closeStream();
              closeStreamController(streamController);
              return;
            }

            unsubscribe = subscribeToContentJobEvents(job.id, (event) => {
              safeEnqueue(
                `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
              );
              if (event.status === "SUCCEEDED" || event.status === "FAILED") {
                closeStream();
                closeStreamController(streamController);
              }
            });
            heartbeat = setInterval(() => {
              safeEnqueue(": heartbeat\n\n");
            }, STREAM_HEARTBEAT_INTERVAL_MS);
          },
          cancel() {
            if (!isClosed) {
              closeStream();
            }
          },
        });

        return c.newResponse(stream, 200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        });
      },
      ...applicationErrorMappers,
    ),
  );
};
