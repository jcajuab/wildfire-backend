import { describeRoute, resolver } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { errorResponseSchema } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  deviceIdParamSchema,
  deviceManifestSchema,
  deviceSchema,
  registerDeviceRequestBodySchema,
  registerDeviceSchema,
} from "#/interfaces/http/validators/devices.schema";
import { scheduleSchema } from "#/interfaces/http/validators/schedules.schema";
import {
  validateJson,
  validateParams,
} from "#/interfaces/http/validators/standard-validator";
import {
  type DeviceAuthMiddleware,
  type DevicesRouter,
  type DevicesRouterUseCases,
  deviceTags,
} from "./shared";

export const registerDeviceApiRoutes = (args: {
  router: DevicesRouter;
  useCases: DevicesRouterUseCases;
  requireDeviceApiKey: DeviceAuthMiddleware;
}) => {
  const { router, useCases, requireDeviceApiKey } = args;

  router.post(
    "/",
    setAction("devices.device.register", {
      route: "/devices",
      actorType: "device",
      resourceType: "device",
    }),
    requireDeviceApiKey,
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
          name: payload.name,
          identifier: payload.identifier,
          location: payload.location ?? null,
        });
        c.set("actorId", result.id);
        c.set("resourceId", result.id);
        return c.json(result);
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/:id/active-schedule",
    setAction("devices.schedule.read", {
      route: "/devices/:id/active-schedule",
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
    setAction("devices.manifest.read", {
      route: "/devices/:id/manifest",
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
