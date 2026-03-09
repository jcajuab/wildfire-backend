import { describeRoute, resolver } from "hono-openapi";
import { createSseResponse, createSseStream } from "#/interfaces/http/lib/sse";
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
import {
  type ContentRouter,
  type ContentRouterDeps,
  type ContentRouterUseCases,
  contentTags,
  type RequirePermission,
} from "./shared";

const STREAM_HEARTBEAT_INTERVAL_MS = 15_000;

export const registerContentJobRoutes = (args: {
  router: ContentRouter;
  deps: ContentRouterDeps;
  useCases: ContentRouterUseCases;
  requirePermission: RequirePermission;
}) => {
  const { router, deps, useCases, requirePermission } = args;

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
        401: { ...unauthorizedResponse },
        403: { ...forbiddenResponse },
        404: { ...notFoundResponse },
        422: { ...validationErrorResponse },
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
        const stream = createSseStream({
          heartbeatIntervalMs: STREAM_HEARTBEAT_INTERVAL_MS,
          start(handle) {
            handle.send(
              `event: connected\ndata: ${JSON.stringify({ jobId: job.id, timestamp: new Date().toISOString() })}\n\n`,
            );
            handle.send(`event: snapshot\ndata: ${JSON.stringify(job)}\n\n`);

            if (job.status === "SUCCEEDED" || job.status === "FAILED") {
              handle.close();
              return;
            }

            return deps.contentJobEventSubscription.subscribe(
              job.id,
              (event) => {
                handle.send(
                  `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
                );
                if (event.status === "SUCCEEDED" || event.status === "FAILED") {
                  handle.close();
                }
              },
            );
          },
        });

        return createSseResponse(stream);
      },
      ...applicationErrorMappers,
    ),
  );
};
