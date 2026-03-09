import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { createSseResponse, createSseStream } from "#/interfaces/http/lib/sse";
import { setAction } from "#/interfaces/http/middleware/observability";
import { notFound } from "#/interfaces/http/responses";
import {
  forbiddenResponse,
  unauthorizedResponse,
  validationErrorResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import { validateParams } from "#/interfaces/http/validators/standard-validator";
import { displayTags } from "../contracts";
import {
  type AuthorizePermission,
  type DisplaysRouter,
  type DisplaysRouterDeps,
} from "../module";

const DISPLAY_EVENTS_HEARTBEAT_INTERVAL_MS = 20 * 1000;
const REGISTRATION_ATTEMPT_HEARTBEAT_INTERVAL_MS = 20 * 1000;

const registrationAttemptParamSchema = z.object({
  attemptId: z.string().uuid(),
});

export const registerDisplayStaffEventRoutes = (input: {
  router: DisplaysRouter;
  deps: DisplaysRouterDeps;
  authorize: AuthorizePermission;
}) => {
  const { router, deps, authorize } = input;

  router.get(
    "/events",
    setAction("displays.events.stream", {
      route: "/displays/events",
      resourceType: "display",
    }),
    ...authorize("displays:read"),
    describeRoute({
      description: "Stream display lifecycle events for admin dashboards",
      tags: displayTags,
      responses: {
        200: {
          description:
            "Server-sent events stream for display lifecycle updates",
          content: {
            "text/event-stream": {
              schema: { type: "string" },
            },
          },
        },
        401: { ...unauthorizedResponse },
        403: { ...forbiddenResponse },
      },
    }),
    async () => {
      const stream = createSseStream({
        heartbeatIntervalMs: DISPLAY_EVENTS_HEARTBEAT_INTERVAL_MS,
        start(handle) {
          handle.send(
            `event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`,
          );
          return deps.lifecycleEventSubscription.subscribe((event) => {
            handle.send(
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            );
          });
        },
      });

      return createSseResponse(stream);
    },
  );

  router.get(
    "/registration-attempts/:attemptId/events",
    setAction("displays.registration-attempt.events", {
      route: "/displays/registration-attempts/:attemptId/events",
      resourceType: "display",
    }),
    ...authorize("displays:create"),
    validateParams(registrationAttemptParamSchema),
    describeRoute({
      description: "Stream registration attempt events via SSE",
      tags: displayTags,
      responses: {
        200: {
          description: "Server-sent events stream for a registration attempt",
          content: {
            "text/event-stream": {
              schema: { type: "string" },
            },
          },
        },
        401: { ...unauthorizedResponse },
        403: { ...forbiddenResponse },
        404: { description: "Registration attempt not found" },
        422: { ...validationErrorResponse },
      },
    }),
    async (c) => {
      const params = c.req.valid("param");
      const userId = c.get("userId");
      if (
        !(await deps.registrationAttemptStore.isAttemptOwnedBy({
          attemptId: params.attemptId,
          ownerId: userId,
        }))
      ) {
        return notFound(c, "Registration attempt not found");
      }

      const stream = createSseStream({
        heartbeatIntervalMs: REGISTRATION_ATTEMPT_HEARTBEAT_INTERVAL_MS,
        start(handle) {
          handle.send(
            `event: connected\ndata: ${JSON.stringify({ attemptId: params.attemptId, timestamp: new Date().toISOString() })}\n\n`,
          );
          return deps.registrationAttemptEventSubscription.subscribe(
            params.attemptId,
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
  );
};
