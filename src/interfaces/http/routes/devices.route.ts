import { Hono, type MiddlewareHandler } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { type DeviceRepository } from "#/application/ports/devices";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type AuthorizationRepository } from "#/application/ports/rbac";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  GetDeviceActiveScheduleUseCase,
  GetDeviceManifestUseCase,
  GetDeviceUseCase,
  ListDevicesUseCase,
  NotFoundError,
  RegisterDeviceUseCase,
} from "#/application/use-cases/devices";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { setAction } from "#/interfaces/http/middleware/observability";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";
import {
  badRequest,
  errorResponseSchema,
  notFound,
  unauthorized,
} from "#/interfaces/http/responses";
import {
  deviceIdParamSchema,
  deviceListResponseSchema,
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

export interface DevicesRouterDeps {
  jwtSecret: string;
  deviceApiKey: string;
  downloadUrlExpiresInSeconds: number;
  scheduleTimeZone?: string;
  repositories: {
    deviceRepository: DeviceRepository;
    scheduleRepository: ScheduleRepository;
    playlistRepository: PlaylistRepository;
    contentRepository: ContentRepository;
    authorizationRepository: AuthorizationRepository;
  };
  storage: ContentStorage;
}

const requireDeviceApiKey =
  (apiKey: string): MiddlewareHandler<{ Variables: JwtUserVariables }> =>
  async (c, next) => {
    const header = c.req.header("x-api-key");
    if (!header || header !== apiKey) {
      return unauthorized(c, "Invalid API key");
    }
    await next();
  };

export const createDevicesRouter = (deps: DevicesRouterDeps) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const deviceTags = ["Devices"];
  const { authorize } = createPermissionMiddleware({
    jwtSecret: deps.jwtSecret,
    authorizationRepository: deps.repositories.authorizationRepository,
  });

  const listDevices = new ListDevicesUseCase({
    deviceRepository: deps.repositories.deviceRepository,
  });
  const getDevice = new GetDeviceUseCase({
    deviceRepository: deps.repositories.deviceRepository,
  });
  const registerDevice = new RegisterDeviceUseCase({
    deviceRepository: deps.repositories.deviceRepository,
  });
  const getActiveSchedule = new GetDeviceActiveScheduleUseCase({
    scheduleRepository: deps.repositories.scheduleRepository,
    playlistRepository: deps.repositories.playlistRepository,
    deviceRepository: deps.repositories.deviceRepository,
    scheduleTimeZone: deps.scheduleTimeZone,
  });
  const getManifest = new GetDeviceManifestUseCase({
    scheduleRepository: deps.repositories.scheduleRepository,
    playlistRepository: deps.repositories.playlistRepository,
    contentRepository: deps.repositories.contentRepository,
    contentStorage: deps.storage,
    deviceRepository: deps.repositories.deviceRepository,
    downloadUrlExpiresInSeconds: deps.downloadUrlExpiresInSeconds,
    scheduleTimeZone: deps.scheduleTimeZone,
  });

  router.post(
    "/",
    setAction("devices.register", {
      route: "/devices",
      actorType: "device",
      resourceType: "device",
    }),
    requireDeviceApiKey(deps.deviceApiKey),
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
    async (c) => {
      const payload = registerDeviceSchema.parse(c.req.valid("json"));
      try {
        const result = await registerDevice.execute({
          name: payload.name,
          identifier: payload.identifier,
          location: payload.location ?? null,
        });
        c.set("actorId", result.id);
        c.set("resourceId", result.id);
        return c.json(result);
      } catch (error) {
        if (error instanceof Error) {
          return badRequest(c, error.message);
        }
        throw error;
      }
    },
  );

  router.get(
    "/",
    setAction("devices.list", { route: "/devices" }),
    ...authorize("devices:read"),
    describeRoute({
      description: "List devices",
      tags: deviceTags,
      responses: {
        200: {
          description: "Devices list",
          content: {
            "application/json": {
              schema: resolver(deviceListResponseSchema),
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
      const items = await listDevices.execute();
      return c.json({ items });
    },
  );

  router.get(
    "/:id",
    setAction("devices.get", { route: "/devices/:id", resourceType: "device" }),
    ...authorize("devices:read"),
    validateParams(deviceIdParamSchema),
    describeRoute({
      description: "Get device",
      tags: deviceTags,
      responses: {
        200: {
          description: "Device details",
          content: {
            "application/json": {
              schema: resolver(deviceSchema),
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
    async (c) => {
      const params = c.req.valid("param");
      c.set("resourceId", params.id);
      try {
        const result = await getDevice.execute({ id: params.id });
        return c.json(result);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );

  router.get(
    "/:id/active-schedule",
    setAction("devices.activeSchedule.read", {
      route: "/devices/:id/active-schedule",
      actorType: "device",
      resourceType: "device",
    }),
    requireDeviceApiKey(deps.deviceApiKey),
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
    async (c) => {
      const params = c.req.valid("param");
      c.set("actorId", params.id);
      c.set("resourceId", params.id);
      try {
        const result = await getActiveSchedule.execute({
          deviceId: params.id,
          now: new Date(),
        });
        return c.json(result);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );

  router.get(
    "/:id/manifest",
    setAction("devices.manifest.read", {
      route: "/devices/:id/manifest",
      actorType: "device",
      resourceType: "device",
    }),
    requireDeviceApiKey(deps.deviceApiKey),
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
    async (c) => {
      const params = c.req.valid("param");
      c.set("actorId", params.id);
      c.set("resourceId", params.id);
      try {
        const result = await getManifest.execute({
          deviceId: params.id,
          now: new Date(),
        });
        return c.json(result);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );

  return router;
};
