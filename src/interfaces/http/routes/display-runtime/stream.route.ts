import { type Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { createSseResponse, createSseStream } from "#/interfaces/http/lib/sse";
import { setAction } from "#/interfaces/http/middleware/observability";
import { errorResponseSchema } from "#/interfaces/http/responses";
import { displayRuntimeTags } from "./contracts";
import {
  type DisplayRuntimeRouterDeps,
  type DisplayRuntimeRouterUseCases,
  type DisplayVars,
} from "./deps";
import { createSignedDisplayRequestMiddleware } from "./middleware";

const STREAM_HEARTBEAT_INTERVAL_MS = 20 * 1000;

export const registerDisplayRuntimeStreamRoutes = (input: {
  router: Hono<{ Variables: DisplayVars }>;
  deps: DisplayRuntimeRouterDeps;
  useCases: DisplayRuntimeRouterUseCases;
}) => {
  const { router, deps, useCases } = input;

  router.get(
    "/:slug/stream",
    setAction("display.stream.read", {
      route: "/display-runtime/:slug/stream",
      actorType: "display",
      resourceType: "display",
    }),
    createSignedDisplayRequestMiddleware({
      authorizeSignedDisplayRequest: useCases.authorizeSignedDisplayRequest,
    }),
    describeRoute({
      description: "Stream display runtime updates via SSE",
      tags: displayRuntimeTags,
      responses: {
        200: {
          description: "Server-sent events stream for display runtime updates",
          content: {
            "text/event-stream": {
              schema: { type: "string" },
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
        404: {
          description: "Display not found",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const displayId = String(c.get("displayId"));
      const stream = createSseStream({
        heartbeatIntervalMs: STREAM_HEARTBEAT_INTERVAL_MS,
        start(handle) {
          handle.send(
            `event: connected\ndata: ${JSON.stringify({ displayId, timestamp: new Date().toISOString() })}\n\n`,
          );
          return deps.displayEventSubscription.subscribe(displayId, (event) => {
            handle.send(
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            );
          });
        },
      });

      return createSseResponse(stream);
    },
  );
};
