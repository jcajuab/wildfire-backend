import { describeRoute, resolver } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { apiResponseSchema, toApiResponse } from "#/interfaces/http/responses";
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
        const result = await useCases.getRuntimeOverrides.execute({
          now: new Date(),
        });
        return c.json(toApiResponse(result));
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/runtime-overrides/emergency/activate",
    setAction("displays.runtime-overrides.emergency.activate", {
      route: "/displays/runtime-overrides/emergency/activate",
      resourceType: "display",
    }),
    ...authorize("displays:update"),
    validateJson(runtimeOverrideEmergencyActionSchema),
    describeRoute({
      description: "Activate global emergency mode",
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
        204: { description: "Global emergency mode activated" },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        await useCases.activateGlobalEmergency.execute({
          reason: payload.reason,
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/runtime-overrides/emergency/deactivate",
    setAction("displays.runtime-overrides.emergency.deactivate", {
      route: "/displays/runtime-overrides/emergency/deactivate",
      resourceType: "display",
    }),
    ...authorize("displays:update"),
    validateJson(runtimeOverrideEmergencyActionSchema),
    describeRoute({
      description: "Deactivate global emergency mode",
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
        204: { description: "Global emergency mode deactivated" },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        await useCases.deactivateGlobalEmergency.execute({
          reason: payload.reason,
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
