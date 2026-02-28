import { type MiddlewareHandler } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { DisplayGroupConflictError } from "#/application/use-cases/displays";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { setAction } from "#/interfaces/http/middleware/observability";
import { conflict, toApiListResponse } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  mapErrorToResponse,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  forbiddenResponse,
  notFoundResponse,
  unauthorizedResponse,
  validationErrorResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import {
  createDisplayGroupRequestBodySchema,
  createDisplayGroupSchema,
  displayGroupIdParamSchema,
  displayGroupListResponseSchema,
  displayGroupSchema,
  displayIdParamSchema,
  displayListQuerySchema,
  displayListResponseSchema,
  displaySchema,
  pairingCodeResponseSchema,
  patchDisplayRequestBodySchema,
  patchDisplaySchema,
  setDisplayGroupsRequestBodySchema,
  setDisplayGroupsSchema,
  updateDisplayGroupRequestBodySchema,
  updateDisplayGroupSchema,
} from "#/interfaces/http/validators/displays.schema";
import {
  validateJson,
  validateParams,
  validateQuery,
} from "#/interfaces/http/validators/standard-validator";
import {
  type DisplaysRouter,
  type DisplaysRouterUseCases,
  displayTags,
} from "./shared";

type AuthorizePermission = (
  permission: string,
) => readonly [
  MiddlewareHandler,
  MiddlewareHandler<{ Variables: JwtUserVariables }>,
];

export const registerDisplayStaffRoutes = (args: {
  router: DisplaysRouter;
  useCases: DisplaysRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = args;

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
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
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

  router.post(
    "/pairing-codes",
    setAction("displays.pairing-code.create", {
      route: "/displays/pairing-codes",
      resourceType: "display",
    }),
    ...authorize("displays:create"),
    describeRoute({
      description: "Issue one-time pairing code for display registration",
      tags: displayTags,
      responses: {
        200: {
          description: "Pairing code",
          content: {
            "application/json": {
              schema: resolver(pairingCodeResponseSchema),
            },
          },
        },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const result = await useCases.issuePairingCode.execute({
          createdById: c.get("userId"),
        });
        return c.json(result);
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
              schema: resolver(displaySchema),
            },
          },
        },
        404: {
          ...notFoundResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const result = await useCases.getDisplay.execute({ id: params.id });
        return c.json(result);
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
              schema: resolver(displaySchema),
            },
          },
        },
        422: {
          ...validationErrorResponse,
        },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
        404: {
          ...notFoundResponse,
        },
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
          outputType: payload.outputType,
          orientation: payload.orientation,
        });
        return c.json(result);
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
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
        404: {
          ...notFoundResponse,
        },
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

  router.get(
    "/groups",
    setAction("displays.group.list", {
      route: "/displays/groups",
      resourceType: "display-group",
    }),
    ...authorize("displays:read"),
    describeRoute({
      description: "List display groups",
      tags: displayTags,
      responses: {
        200: {
          description: "Display groups",
          content: {
            "application/json": {
              schema: resolver(displayGroupListResponseSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const items = await useCases.listDisplayGroups.execute();
        return c.json({ data: items });
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/groups",
    setAction("displays.group.create", {
      route: "/displays/groups",
      resourceType: "display-group",
    }),
    ...authorize("displays:update"),
    validateJson(createDisplayGroupSchema),
    describeRoute({
      description: "Create display group",
      tags: displayTags,
      requestBody: {
        content: {
          "application/json": {
            schema: createDisplayGroupRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        200: {
          description: "Display group",
          content: {
            "application/json": {
              schema: resolver(displayGroupSchema),
            },
          },
        },
        409: {
          description: "Group name already exists",
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const result = await useCases.createDisplayGroup.execute({
          name: payload.name,
          colorIndex: payload.colorIndex,
        });
        c.set("resourceId", result.id);
        return c.json(result);
      },
      ...applicationErrorMappers,
      mapErrorToResponse(DisplayGroupConflictError, conflict),
    ),
  );

  router.patch(
    "/groups/:groupId",
    setAction("displays.group.update", {
      route: "/displays/groups/:groupId",
      resourceType: "display-group",
    }),
    ...authorize("displays:update"),
    validateParams(displayGroupIdParamSchema),
    validateJson(updateDisplayGroupSchema),
    describeRoute({
      description: "Update display group",
      tags: displayTags,
      requestBody: {
        content: {
          "application/json": {
            schema: updateDisplayGroupRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        200: {
          description: "Display group",
          content: {
            "application/json": {
              schema: resolver(displayGroupSchema),
            },
          },
        },
        409: {
          description: "Group name already exists",
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const payload = c.req.valid("json");
        const result = await useCases.updateDisplayGroup.execute({
          id: params.groupId,
          name: payload.name,
          colorIndex: payload.colorIndex,
        });
        c.set("resourceId", result.id);
        return c.json(result);
      },
      ...applicationErrorMappers,
      mapErrorToResponse(DisplayGroupConflictError, conflict),
    ),
  );

  router.delete(
    "/groups/:groupId",
    setAction("displays.group.delete", {
      route: "/displays/groups/:groupId",
      resourceType: "display-group",
    }),
    ...authorize("displays:update"),
    validateParams(displayGroupIdParamSchema),
    describeRoute({
      description: "Delete display group",
      tags: displayTags,
      responses: {
        204: { description: "Deleted" },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        await useCases.deleteDisplayGroup.execute({ id: params.groupId });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  router.put(
    "/:id{[0-9a-fA-F-]{36}}/groups",
    setAction("displays.group.set", {
      route: "/displays/:id/groups",
      resourceType: "display",
    }),
    ...authorize("displays:update"),
    validateParams(displayIdParamSchema),
    validateJson(setDisplayGroupsSchema),
    describeRoute({
      description: "Set display groups for a display",
      tags: displayTags,
      requestBody: {
        content: {
          "application/json": {
            schema: setDisplayGroupsRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        204: { description: "Updated" },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const payload = c.req.valid("json");
        await useCases.setDisplayGroups.execute({
          displayId: params.id,
          groupIds: payload.groupIds,
        });
        c.set("resourceId", params.id);
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
