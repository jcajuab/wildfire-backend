import { describeRoute, resolver } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { errorResponseSchema, unauthorized } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  deviceIdParamSchema,
  deviceManifestSchema,
  deviceSchema,
  deviceStreamQuerySchema,
  deviceStreamTokenResponseSchema,
  registerDeviceRequestBodySchema,
  registerDeviceSchema,
} from "#/interfaces/http/validators/devices.schema";
import { scheduleSchema } from "#/interfaces/http/validators/schedules.schema";
import {
  validateJson,
  validateParams,
  validateQuery,
} from "#/interfaces/http/validators/standard-validator";
import {
  type DeviceAuthMiddleware,
  type DevicesRouter,
  type DevicesRouterUseCases,
  deviceTags,
} from "./shared";
import {
  createDeviceStreamToken,
  subscribeToDeviceStream,
  verifyDeviceStreamToken,
} from "./stream";

const STREAM_TOKEN_TTL_MS = 5 * 60 * 1000;
const STREAM_HEARTBEAT_INTERVAL_MS = 20 * 1000;

export const registerDeviceApiRoutes = (args: {
  router: DevicesRouter;
  useCases: DevicesRouterUseCases;
  requireDeviceApiKey: DeviceAuthMiddleware;
  streamTokenSecret: string;
}) => {
  const { router, useCases, requireDeviceApiKey, streamTokenSecret } = args;

  router.post(
    "/",
    setAction("displays.device.register", {
      route: "/displays",
      actorType: "device",
      resourceType: "device",
    }),
    validateJson(registerDeviceSchema),
    describeRoute({
      description: "Register or update a device",
      tags: deviceTags,
      requestBody: {
        content: {
          "application/json": {
            schema: registerDeviceRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        200: {
          description: "Device registered",
          content: {
            "application/json": {
              schema: resolver(deviceSchema),
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
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const result = await useCases.registerDevice.execute({
          pairingCode: payload.pairingCode,
          name: payload.name,
          identifier: payload.identifier,
          deviceFingerprint: payload.deviceFingerprint ?? null,
          location: payload.location ?? null,
          ipAddress: payload.ipAddress ?? null,
          macAddress: payload.macAddress ?? null,
          screenWidth: payload.screenWidth,
          screenHeight: payload.screenHeight,
          outputType: payload.outputType ?? null,
          orientation: payload.orientation ?? null,
        });
        c.set("actorId", result.id);
        c.set("resourceId", result.id);
        return c.json(result);
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/:id/stream-token",
    setAction("displays.stream.token", {
      route: "/displays/:id/stream-token",
      actorType: "device",
      resourceType: "device",
    }),
    requireDeviceApiKey,
    validateParams(deviceIdParamSchema),
    describeRoute({
      description: "Issue short-lived stream token for SSE",
      tags: deviceTags,
      responses: {
        200: {
          description: "Stream token",
          content: {
            "application/json": {
              schema: resolver(deviceStreamTokenResponseSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(async (c) => {
      const params = c.req.valid("param");
      const expiresAt = new Date(Date.now() + STREAM_TOKEN_TTL_MS);
      const token = createDeviceStreamToken({
        deviceId: params.id,
        secret: streamTokenSecret,
        expiresAt,
      });
      return c.json({
        token,
        expiresAt: expiresAt.toISOString(),
      });
    }),
  );

  router.get(
    "/:id/stream",
    setAction("displays.stream.read", {
      route: "/displays/:id/stream",
      actorType: "device",
      resourceType: "device",
    }),
    validateParams(deviceIdParamSchema),
    validateQuery(deviceStreamQuerySchema),
    describeRoute({
      description: "Subscribe device to server-sent events stream",
      tags: deviceTags,
      responses: {
        200: {
          description: "SSE stream",
        },
      },
    }),
    async (c) => {
      const params = c.req.valid("param");
      const query = c.req.valid("query");
      const isValid = verifyDeviceStreamToken({
        token: query.streamToken,
        deviceId: params.id,
        secret: streamTokenSecret,
        now: new Date(),
      });
      if (!isValid) {
        return unauthorized(c, "Invalid stream token");
      }

      const encoder = new TextEncoder();
      let unsubscribe: (() => void) | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `event: connected\ndata: ${JSON.stringify({ deviceId: params.id, timestamp: new Date().toISOString() })}\n\n`,
            ),
          );
          unsubscribe = subscribeToDeviceStream(params.id, (event) => {
            controller.enqueue(
              encoder.encode(
                `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
              ),
            );
          });
          heartbeat = setInterval(() => {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          }, STREAM_HEARTBEAT_INTERVAL_MS);
        },
        cancel() {
          if (unsubscribe) unsubscribe();
          if (heartbeat) clearInterval(heartbeat);
        },
      });

      return c.newResponse(stream, 200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
    },
  );

  router.get(
    "/:id/active-schedule",
    setAction("displays.schedule.read", {
      route: "/displays/:id/active-schedule",
      actorType: "device",
      resourceType: "device",
    }),
    requireDeviceApiKey,
    validateParams(deviceIdParamSchema),
    describeRoute({
      description: "Get active schedule for device",
      tags: deviceTags,
      responses: {
        200: {
          description: "Active schedule",
          content: {
            "application/json": {
              schema: resolver(scheduleSchema.nullable()),
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
          description: "Not found",
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
        const params = c.req.valid("param");
        c.set("actorId", params.id);
        c.set("resourceId", params.id);
        const result = await useCases.getActiveSchedule.execute({
          deviceId: params.id,
          now: new Date(),
        });
        return c.json(result);
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/:id/manifest",
    setAction("displays.manifest.read", {
      route: "/displays/:id/manifest",
      actorType: "device",
      resourceType: "device",
    }),
    requireDeviceApiKey,
    validateParams(deviceIdParamSchema),
    describeRoute({
      description: "Get device manifest",
      tags: deviceTags,
      responses: {
        200: {
          description: "Manifest",
          content: {
            "application/json": {
              schema: resolver(deviceManifestSchema),
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
          description: "Not found",
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
        const params = c.req.valid("param");
        c.set("actorId", params.id);
        c.set("resourceId", params.id);
        const result = await useCases.getManifest.execute({
          deviceId: params.id,
          now: new Date(),
        });
        return c.json(result);
      },
      ...applicationErrorMappers,
    ),
  );
};
