import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { DisplayGroupConflictError } from "#/application/use-cases/displays";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  apiResponseSchema,
  conflict,
  toApiResponse,
} from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  mapErrorToResponse,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  createDisplayGroupRequestBodySchema,
  createDisplayGroupSchema,
  displayGroupIdParamSchema,
  displayGroupSchema,
  displayIdParamSchema,
  setDisplayGroupsRequestBodySchema,
  setDisplayGroupsSchema,
  updateDisplayGroupRequestBodySchema,
  updateDisplayGroupSchema,
} from "#/interfaces/http/validators/displays.schema";
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

export const registerDisplayStaffGroupRoutes = (input: {
  router: DisplaysRouter;
  useCases: DisplaysRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = input;

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
              schema: resolver(apiResponseSchema(z.array(displayGroupSchema))),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const items = await useCases.listDisplayGroups.execute();
        return c.json(toApiResponse(items));
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
        201: {
          description: "Display group created",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(displayGroupSchema)),
            },
          },
        },
        409: { description: "Group name already exists" },
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
        c.header("Location", `${c.req.path}/${encodeURIComponent(result.id)}`);
        return c.json(toApiResponse(result), 201);
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
              schema: resolver(apiResponseSchema(displayGroupSchema)),
            },
          },
        },
        409: { description: "Group name already exists" },
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
        return c.json(toApiResponse(result));
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
