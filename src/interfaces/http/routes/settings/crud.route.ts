import { describeRoute, resolver } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { publishDisplayStreamEvent } from "#/interfaces/http/routes/displays/stream";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  displayRuntimeSettingsSchema,
  updateDisplayRuntimeSettingsSchema,
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
  listDisplayIds: () => Promise<string[]>;
}) => {
  const { router, useCases, authorize, listDisplayIds } = args;

  router.get(
    "/display-runtime",
    setAction("settings.displayRuntime.read", {
      route: "/settings/display-runtime",
      resourceType: "setting",
    }),
    ...authorize("settings:read"),
    describeRoute({
      description: "Get display runtime settings",
      tags: settingsTags,
      responses: {
        200: {
          description: "Current display runtime settings",
          content: {
            "application/json": {
              schema: resolver(displayRuntimeSettingsSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const result = await useCases.getDisplayRuntimeSettings.execute();
        c.set("resourceId", "display-runtime");
        return c.json(result);
      },
      ...applicationErrorMappers,
    ),
  );

  router.patch(
    "/display-runtime",
    setAction("settings.displayRuntime.update", {
      route: "/settings/display-runtime",
      resourceType: "setting",
    }),
    ...authorize("settings:update"),
    validateJson(updateDisplayRuntimeSettingsSchema),
    describeRoute({
      description: "Update display runtime settings",
      tags: settingsTags,
      responses: {
        200: {
          description: "Updated settings",
          content: {
            "application/json": {
              schema: resolver(displayRuntimeSettingsSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const result = await useCases.updateDisplayRuntimeSettings.execute({
          scrollPxPerSecond: payload.scrollPxPerSecond,
        });
        const displayIds = await listDisplayIds();
        for (const displayId of displayIds) {
          publishDisplayStreamEvent({
            type: "manifest_updated",
            displayId,
            reason: "display_runtime_settings_updated",
            timestamp: new Date().toISOString(),
          });
        }
        c.set("resourceId", "display-runtime");
        return c.json(result);
      },
      ...applicationErrorMappers,
    ),
  );
};
