import { describeRoute, resolver } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { publishDeviceStreamEvent } from "#/interfaces/http/routes/devices/stream";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  deviceRuntimeSettingsSchema,
  updateDeviceRuntimeSettingsSchema,
} from "#/interfaces/http/validators/settings.schema";
import { validateJson } from "#/interfaces/http/validators/standard-validator";
import {
  type AuthorizePermission,
  type SettingsRouter,
  type SettingsRouterUseCases,
  settingsTags,
} from "./shared";

export const registerSettingsCrudRoutes = (args: {
  router: SettingsRouter;
  useCases: SettingsRouterUseCases;
  authorize: AuthorizePermission;
  listDeviceIds: () => Promise<string[]>;
}) => {
  const { router, useCases, authorize, listDeviceIds } = args;

  router.get(
    "/device-runtime",
    setAction("settings.deviceRuntime.read", {
      route: "/settings/device-runtime",
      resourceType: "setting",
    }),
    ...authorize("settings:read"),
    describeRoute({
      description: "Get device runtime settings",
      tags: settingsTags,
      responses: {
        200: {
          description: "Current device runtime settings",
          content: {
            "application/json": {
              schema: resolver(deviceRuntimeSettingsSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const result = await useCases.getDeviceRuntimeSettings.execute();
        c.set("resourceId", "device-runtime");
        return c.json(result);
      },
      ...applicationErrorMappers,
    ),
  );

  router.patch(
    "/device-runtime",
    setAction("settings.deviceRuntime.update", {
      route: "/settings/device-runtime",
      resourceType: "setting",
    }),
    ...authorize("settings:update"),
    validateJson(updateDeviceRuntimeSettingsSchema),
    describeRoute({
      description: "Update device runtime settings",
      tags: settingsTags,
      responses: {
        200: {
          description: "Updated settings",
          content: {
            "application/json": {
              schema: resolver(deviceRuntimeSettingsSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const result = await useCases.updateDeviceRuntimeSettings.execute({
          scrollPxPerSecond: payload.scrollPxPerSecond,
        });
        const deviceIds = await listDeviceIds();
        for (const deviceId of deviceIds) {
          publishDeviceStreamEvent({
            type: "manifest_updated",
            deviceId,
            reason: "device_runtime_settings_updated",
            timestamp: new Date().toISOString(),
          });
        }
        c.set("resourceId", "device-runtime");
        return c.json(result);
      },
      ...applicationErrorMappers,
    ),
  );
};
