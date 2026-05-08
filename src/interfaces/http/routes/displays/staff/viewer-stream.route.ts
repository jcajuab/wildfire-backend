import { describeRoute } from "hono-openapi";
import { createSseResponse, createSseStream } from "#/interfaces/http/lib/sse";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  authErrorResponses,
  notFoundResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import { displaySlugParamSchema } from "#/interfaces/http/validators/displays.schema";
import { validateParams } from "#/interfaces/http/validators/standard-validator";
import { displayTags } from "../contracts";
import {
  type AuthorizePermission,
  type DisplaysRouter,
  type DisplaysRouterDeps,
  type DisplaysRouterUseCases,
} from "../module";

const STREAM_HEARTBEAT_INTERVAL_MS = 20 * 1000;

export const registerViewerStreamRoute = (input: {
  router: DisplaysRouter;
  deps: DisplaysRouterDeps;
  useCases: DisplaysRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, deps, useCases, authorize } = input;

  router.get(
    "/by-slug/:slug/stream",
    setAction("displays.display.viewer-stream", {
      route: "/displays/by-slug/:slug/stream",
      resourceType: "display",
    }),
    ...authorize("displays:read"),
    validateParams(displaySlugParamSchema),
    describeRoute({
      description:
        "Stream display runtime updates via SSE (JWT-authenticated viewer mode)",
      tags: displayTags,
      responses: {
        200: {
          description:
            "Server-sent events stream for display runtime updates (viewer)",
          content: {
            "text/event-stream": {
              schema: { type: "string" },
            },
          },
        },
        401: { ...authErrorResponses[401] },
        404: { ...notFoundResponse },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const display = await useCases.getDisplayManifest.resolveDisplayBySlug(
          params.slug,
        );
        c.set("resourceId", display.id);

        const stream = createSseStream({
          heartbeatIntervalMs: STREAM_HEARTBEAT_INTERVAL_MS,
          start(handle) {
            handle.send(
              `event: connected\ndata: ${JSON.stringify({ displayId: display.id, timestamp: new Date().toISOString() })}\n\n`,
            );
            return deps.displayEventSubscription.subscribe(
              display.id,
              (event) => {
                handle.send(
                  `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
                );
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
