import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { DisplayGroupConflictError } from "#/application/use-cases/displays";
import {
  invalidateServerCache,
  jsonWithServerCache,
} from "#/interfaces/http/cache/server-cache";
import { setAction } from "#/interfaces/http/middleware/observability";
import { requireAdmin } from "#/interfaces/http/middleware/require-admin";
import {
  apiResponseSchema,
  conflict,
  toApiListResponse,
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
  displayGroupListQuerySchema,
  displayGroupListResponseSchema,
  displayGroupSchema,
  displayIdParamSchema,
  resolveDisplayGroupsRequestBodySchema,
  resolveDisplayGroupsSchema,
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
    validateQuery(displayGroupListQuerySchema),
    describeRoute({
      description: "List display groups (paginated)",
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
        return jsonWithServerCache(
          c,
          { domains: ["displays"], ttl: "reference" },
          async () => {
            const query = c.req.valid("query");
            const result = await useCases.searchDisplayGroups.execute({
              page: query.page,
              pageSize: query.pageSize,
              q: query.q,
              displayId: query.displayId,
              membership: query.membership,
              sortBy: query.sortBy,
              sortDirection: query.sortDirection,
            });
            return toApiListResponse({
              items: result.items,
              total: result.total,
              page: result.page,
              pageSize: result.pageSize,
              requestUrl: c.req.url,
            });
          },
        );
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/groups/resolve",
    setAction("displays.group.resolve", {
      route: "/displays/groups/resolve",
      resourceType: "display-group",
    }),
    ...authorize("displays:update"),
    requireAdmin,
    validateJson(resolveDisplayGroupsSchema),
    describeRoute({
      description: "Resolve display group names to IDs (creating if missing)",
      tags: displayTags,
      requestBody: {
        content: {
          "application/json": {
            schema: resolveDisplayGroupsRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        200: {
          description: "Resolved display groups",
          content: {
            "application/json": {
              schema: resolver(
                apiResponseSchema(
                  z.object({
                    items: z.array(
                      z.object({
                        id: z.string().uuid(),
                        name: z.string(),
                      }),
                    ),
                  }),
                ),
              ),
            },
          },
        },
        409: { description: "Group name conflict" },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const result = await useCases.resolveDisplayGroups.execute({
          names: payload.names,
        });
        await invalidateServerCache(["displays"]);
        return c.json({ data: result });
      },
      ...applicationErrorMappers,
      mapErrorToResponse(DisplayGroupConflictError, conflict),
    ),
  );

  router.post(
    "/groups",
    setAction("displays.group.create", {
      route: "/displays/groups",
      resourceType: "display-group",
    }),
    ...authorize("displays:update"),
    requireAdmin,
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
        });
        c.set("resourceId", result.id);
        c.header("Location", `${c.req.path}/${encodeURIComponent(result.id)}`);
        await invalidateServerCache(["displays"]);
        return c.json({ data: result }, 201);
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
    requireAdmin,
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
        });
        c.set("resourceId", result.id);
        await invalidateServerCache(["displays"]);
        return c.json({ data: result });
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
    requireAdmin,
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
        await invalidateServerCache(["displays"]);
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
    requireAdmin,
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
        await invalidateServerCache(["displays"]);
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
