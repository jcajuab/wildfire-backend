import { describeRoute, resolver } from "hono-openapi";
import { ValidationError } from "#/application/errors/validation";
import {
  invalidateServerCache,
  jsonWithServerCache,
} from "#/interfaces/http/cache/server-cache";
import { setAction } from "#/interfaces/http/middleware/observability";
import { requireAdmin } from "#/interfaces/http/middleware/require-admin";
import { apiResponseSchema } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  authErrorResponses,
  authValidationErrorResponses,
} from "#/interfaces/http/routes/shared/openapi-responses";
import {
  displayRuntimeOverridesSchema,
  runtimeOverrideEmergencyActionBodySchema,
  runtimeOverrideEmergencyActionSchema,
} from "#/interfaces/http/validators/displays.schema";
import { validateJson } from "#/interfaces/http/validators/standard-validator";
import { displayTags } from "../contracts";
import {
  type AuthorizePermission,
  type DisplaysRouter,
  type DisplaysRouterUseCases,
} from "../module";

export const registerDisplayStaffRuntimeOverrideRoutes = (input: {
  router: DisplaysRouter;
  useCases: DisplaysRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = input;

  router.get(
    "/runtime-overrides",
    setAction("displays.runtime-overrides.get", {
      route: "/displays/runtime-overrides",
      resourceType: "display",
    }),
    ...authorize("displays:read"),
    describeRoute({
      description: "Get global emergency and active flash runtime overrides",
      tags: displayTags,
      responses: {
        200: {
          description: "Runtime overrides",
          content: {
            "application/json": {
              schema: resolver(
                apiResponseSchema(displayRuntimeOverridesSchema),
              ),
            },
          },
        },
        ...authErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        return jsonWithServerCache(
          c,
          { domains: ["displays"], ttl: "dynamic" },
          async () => {
            const result = await useCases.getRuntimeOverrides.execute({
              now: new Date(),
            });
            return { data: result };
          },
        );
      },
      ...applicationErrorMappers,
    ),
  );

  router.put(
    "/runtime-overrides/emergency",
    setAction("displays.runtime-overrides.emergency.update", {
      route: "/displays/runtime-overrides/emergency",
      resourceType: "display",
    }),
    ...authorize("displays:update"),
    requireAdmin,
    validateJson(runtimeOverrideEmergencyActionSchema),
    describeRoute({
      description:
        "Update global emergency mode. Set active: true to activate, false to deactivate.",
      tags: displayTags,
      requestBody: {
        content: {
          "application/json": {
            schema: runtimeOverrideEmergencyActionBodySchema,
          },
        },
        required: true,
      },
      responses: {
        204: { description: "Global emergency mode updated" },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        if (payload.active) {
          if (typeof payload.slotIndex !== "number") {
            throw new ValidationError(
              "slotIndex is required when active is true",
            );
          }
          await useCases.activateGlobalEmergency.execute({
            slotIndex: payload.slotIndex,
            reason: payload.reason,
          });
        } else {
          await useCases.deactivateGlobalEmergency.execute({
            reason: payload.reason,
          });
        }
        await invalidateServerCache(["displays", "schedules"]);
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
