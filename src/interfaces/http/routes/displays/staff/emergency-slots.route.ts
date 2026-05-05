import { describeRoute } from "hono-openapi";
import {
  invalidateServerCache,
  jsonWithServerCache,
} from "#/interfaces/http/cache/server-cache";
import { setAction } from "#/interfaces/http/middleware/observability";
import { requireAdmin } from "#/interfaces/http/middleware/require-admin";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  authErrorResponses,
  authValidationErrorResponses,
  notFoundResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import {
  emergencySlotIndexParamSchema,
  setEmergencySlotRequestBodySchema,
  setEmergencySlotSchema,
} from "#/interfaces/http/validators/emergency-slots.schema";
import {
  validateJson,
  validateParams,
} from "#/interfaces/http/validators/standard-validator";
import { displayTags } from "../contracts";
import {
  type AuthorizePermission,
  type DisplaysRouter,
  type DisplaysRouterUseCases,
} from "../module";

export const registerEmergencySlotRoutes = (input: {
  router: DisplaysRouter;
  useCases: DisplaysRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = input;

  router.get(
    "/emergency-slots",
    setAction("displays.emergency-slots.list", {
      route: "/displays/emergency-slots",
    }),
    ...authorize("displays:read"),
    describeRoute({
      description: "List the 5 system-wide emergency slots",
      tags: displayTags,
      responses: {
        200: { description: "Emergency slots" },
        ...authErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        return jsonWithServerCache(
          c,
          { domains: ["displays"], ttl: "dynamic" },
          async () => {
            const slots = await useCases.listEmergencySlots.execute();
            return { data: { slots } };
          },
        );
      },
      ...applicationErrorMappers,
    ),
  );

  router.put(
    "/emergency-slots/:slotIndex",
    setAction("displays.emergency-slots.set", {
      route: "/displays/emergency-slots/:slotIndex",
    }),
    ...authorize("displays:update"),
    requireAdmin,
    validateParams(emergencySlotIndexParamSchema),
    validateJson(setEmergencySlotSchema),
    describeRoute({
      description: "Configure (upsert) the contents of an emergency slot",
      tags: displayTags,
      requestBody: {
        content: {
          "application/json": {
            schema: setEmergencySlotRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        200: { description: "Emergency slot updated" },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const payload = c.req.valid("json");
        await useCases.setEmergencySlot.execute({
          slotIndex: params.slotIndex,
          label: payload.label,
          contentId: payload.contentId,
        });
        await invalidateServerCache(["displays"]);
        const slots = await useCases.listEmergencySlots.execute();
        const slot = slots.find(
          (entry) => entry.slotIndex === params.slotIndex,
        );
        return c.json({ data: slot });
      },
      ...applicationErrorMappers,
    ),
  );

  router.delete(
    "/emergency-slots/:slotIndex",
    setAction("displays.emergency-slots.clear", {
      route: "/displays/emergency-slots/:slotIndex",
    }),
    ...authorize("displays:update"),
    requireAdmin,
    validateParams(emergencySlotIndexParamSchema),
    describeRoute({
      description: "Clear an emergency slot",
      tags: displayTags,
      responses: {
        204: { description: "Emergency slot cleared" },
        404: { ...notFoundResponse },
        ...authErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        await useCases.clearEmergencySlot.execute({
          slotIndex: params.slotIndex,
        });
        await invalidateServerCache(["displays"]);
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
