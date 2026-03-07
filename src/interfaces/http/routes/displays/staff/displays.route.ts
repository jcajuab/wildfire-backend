import { describeRoute, resolver } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  apiResponseSchema,
  toApiListResponse,
  toApiResponse,
} from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  forbiddenResponse,
  notFoundResponse,
  unauthorizedResponse,
  validationErrorResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import {
  displayIdParamSchema,
  displayListQuerySchema,
  displayListResponseSchema,
  displaySchema,
  patchDisplayRequestBodySchema,
  patchDisplaySchema,
} from "#/interfaces/http/validators/displays.schema";
import {
  validateJson,
  validateParams,
  validateQuery,
} from "#/interfaces/http/validators/standard-validator";
import { displayTags } from "../contracts";
import {
  type AuthorizePermission,
  type DisplaysRouter,
  type DisplaysRouterUseCases,
} from "../module";

export const registerDisplayStaffDisplayRoutes = (input: {
  router: DisplaysRouter;
  useCases: DisplaysRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = input;

  router.get(
    "/",
    setAction("displays.display.list", { route: "/displays" }),
    ...authorize("displays:read"),
    validateQuery(displayListQuerySchema),
    describeRoute({
      description: "List displays",
      tags: displayTags,
      responses: {
        200: {
          description: "Displays list",
          content: {
            "application/json": {
              schema: resolver(displayListResponseSchema),
            },
          },
        },
        401: { ...unauthorizedResponse },
        403: { ...forbiddenResponse },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const query = c.req.valid("query");
        const result = await useCases.listDisplays.execute({
          page: query.page,
          pageSize: query.pageSize,
        });
        return c.json(
          toApiListResponse({
            items: result.items,
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            requestUrl: c.req.url,
          }),
        );
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/:id{[0-9a-fA-F-]{36}}/preview",
    setAction("displays.display.preview", {
      route: "/displays/:id/preview",
      resourceType: "display",
    }),
    ...authorize("displays:read"),
    validateParams(displayIdParamSchema),
    describeRoute({
      description: "Get latest display preview image",
      tags: displayTags,
      responses: {
        200: {
          description: "Display preview image",
          content: {
            "image/jpeg": { schema: { type: "string", format: "binary" } },
            "image/png": { schema: { type: "string", format: "binary" } },
            "image/webp": { schema: { type: "string", format: "binary" } },
          },
        },
        204: { description: "No preview available" },
        401: { ...unauthorizedResponse },
        403: { ...forbiddenResponse },
        404: { ...notFoundResponse },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const preview = await useCases.getDisplayPreview.execute({
          id: params.id,
        });
        if (!preview) {
          return c.body(null, 204);
        }

        return c.body(preview.bytes, 200, {
          "Content-Type": preview.mimeType,
          "Cache-Control": "no-store",
          "Last-Modified": preview.lastModified,
        });
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/:id{[0-9a-fA-F-]{36}}",
    setAction("displays.display.get", {
      route: "/displays/:id",
      resourceType: "display",
    }),
    ...authorize("displays:read"),
    validateParams(displayIdParamSchema),
    describeRoute({
      description: "Get display",
      tags: displayTags,
      responses: {
        200: {
          description: "Display details",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(displaySchema)),
            },
          },
        },
        404: { ...notFoundResponse },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const result = await useCases.getDisplay.execute({ id: params.id });
        return c.json(toApiResponse(result));
      },
      ...applicationErrorMappers,
    ),
  );

  router.patch(
    "/:id{[0-9a-fA-F-]{36}}",
    setAction("displays.display.update", {
      route: "/displays/:id",
      resourceType: "display",
    }),
    ...authorize("displays:update"),
    validateParams(displayIdParamSchema),
    validateJson(patchDisplaySchema),
    describeRoute({
      description: "Update display",
      tags: displayTags,
      requestBody: {
        content: {
          "application/json": {
            schema: patchDisplayRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        200: {
          description: "Updated display",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(displaySchema)),
            },
          },
        },
        422: { ...validationErrorResponse },
        401: { ...unauthorizedResponse },
        403: { ...forbiddenResponse },
        404: { ...notFoundResponse },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const payload = c.req.valid("json");
        c.set("resourceId", params.id);
        const result = await useCases.updateDisplay.execute({
          id: params.id,
          name: payload.name,
          location: payload.location,
          ipAddress: payload.ipAddress,
          macAddress: payload.macAddress,
          screenWidth: payload.screenWidth,
          screenHeight: payload.screenHeight,
          output: payload.output,
          orientation: payload.orientation,
          emergencyContentId: payload.emergencyContentId,
        });
        return c.json(toApiResponse(result));
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/:id{[0-9a-fA-F-]{36}}/refresh",
    setAction("displays.display.refresh", {
      route: "/displays/:id/refresh",
      resourceType: "display",
    }),
    ...authorize("displays:update"),
    validateParams(displayIdParamSchema),
    describeRoute({
      description: "Queue a refresh signal for a display",
      tags: displayTags,
      responses: {
        204: { description: "Refresh queued" },
        401: { ...unauthorizedResponse },
        403: { ...forbiddenResponse },
        404: { ...notFoundResponse },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        await useCases.requestDisplayRefresh.execute({ id: params.id });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/:id{[0-9a-fA-F-]{36}}/unregister",
    setAction("displays.display.unregister", {
      route: "/displays/:id/unregister",
      resourceType: "display",
    }),
    ...authorize("displays:delete"),
    validateParams(displayIdParamSchema),
    describeRoute({
      description: "Unregister display and revoke display authentication",
      tags: displayTags,
      responses: {
        204: { description: "Display unregistered" },
        401: { ...unauthorizedResponse },
        403: { ...forbiddenResponse },
        404: { ...notFoundResponse },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        await useCases.unregisterDisplay.execute({
          id: params.id,
          actorId: c.get("userId"),
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
