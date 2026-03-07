import { type Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { errorResponseSchema } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import { displayRuntimeTags } from "./contracts";
import { type DisplayRuntimeRouterUseCases, type DisplayVars } from "./deps";
import { createSignedDisplayRequestMiddleware } from "./middleware";

export const registerDisplayRuntimeHeartbeatRoutes = (input: {
  router: Hono<{ Variables: DisplayVars }>;
  useCases: DisplayRuntimeRouterUseCases;
}) => {
  const { router, useCases } = input;

  router.post(
    "/:slug/heartbeat",
    setAction("display.heartbeat", {
      route: "/display-runtime/:slug/heartbeat",
      actorType: "display",
      resourceType: "display",
    }),
    createSignedDisplayRequestMiddleware({
      authorizeSignedDisplayRequest: useCases.authorizeSignedDisplayRequest,
    }),
    describeRoute({
      description: "Post display heartbeat to update runtime status",
      tags: displayRuntimeTags,
      responses: {
        204: { description: "Heartbeat accepted" },
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
    withRouteErrorHandling(
      async (c) => {
        await useCases.recordDisplayHeartbeat.execute({
          displayId: String(c.get("displayId")),
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
