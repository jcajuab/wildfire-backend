import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  apiResponseSchema,
  errorResponseSchema,
  toApiListResponse,
  toApiResponse,
} from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  mergedPlaylistQuerySchema,
  mergedPlaylistResponseSchema,
  scheduleIdParamSchema,
  scheduleListQuerySchema,
  scheduleListResponseSchema,
  scheduleResponseSchema,
  scheduleSchema,
  scheduleWindowQuerySchema,
} from "#/interfaces/http/validators/schedules.schema";
import {
  validateParams,
  validateQuery,
} from "#/interfaces/http/validators/standard-validator";
import {
  type AuthorizePermission,
  type SchedulesRouter,
  type SchedulesRouterUseCases,
  scheduleTags,
} from "./shared";

export const registerScheduleQueryRoutes = (args: {
  router: SchedulesRouter;
  useCases: SchedulesRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = args;

  router.get(
    "/",
    setAction("schedules.schedule.list", { route: "/schedules" }),
    ...authorize("schedules:read"),
    validateQuery(scheduleListQuerySchema),
    describeRoute({
      description: "List schedules",
      tags: scheduleTags,
      responses: {
        200: {
          description: "Schedules list",
          content: {
            "application/json": {
              schema: resolver(scheduleListResponseSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const query = c.req.valid("query");
        const result = await useCases.listSchedules.execute({
          ownerId: c.get("userId"),
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
    "/window",
    setAction("schedules.schedule.window", { route: "/schedules/window" }),
    ...authorize("schedules:read"),
    validateQuery(scheduleWindowQuerySchema),
    describeRoute({
      description: "List schedules intersecting a calendar window",
      tags: scheduleTags,
      responses: {
        200: {
          description: "Windowed schedules",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(z.array(scheduleSchema))),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const query = c.req.valid("query");
        const result = await useCases.listScheduleWindow.execute({
          ownerId: c.get("userId"),
          from: query.from,
          to: query.to,
          displayIds: query.displayIds,
        });
        return c.json(toApiResponse(result));
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/merged",
    setAction("schedules.schedule.merged", { route: "/schedules/merged" }),
    ...authorize("schedules:read"),
    validateQuery(mergedPlaylistQuerySchema),
    describeRoute({
      description:
        "Get merged playlist for a display at a given time. Returns all playlist items from overlapping schedules.",
      tags: scheduleTags,
      responses: {
        200: {
          description: "Merged playlist items",
          content: {
            "application/json": {
              schema: resolver(mergedPlaylistResponseSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const query = c.req.valid("query");
        const result = await useCases.getMergedPlaylist.execute({
          displayId: query.displayId,
          time: query.time ? new Date(query.time) : undefined,
        });
        return c.json(toApiResponse(result));
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/:id",
    setAction("schedules.schedule.get", {
      route: "/schedules/:id",
      resourceType: "schedule",
    }),
    ...authorize("schedules:read"),
    validateParams(scheduleIdParamSchema),
    describeRoute({
      description: "Get schedule",
      tags: scheduleTags,
      responses: {
        200: {
          description: "Schedule details",
          content: {
            "application/json": {
              schema: resolver(scheduleResponseSchema),
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
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const result = await useCases.getSchedule.execute({
          id: params.id,
          ownerId: c.get("userId"),
        });
        return c.json(toApiResponse(result));
      },
      ...applicationErrorMappers,
    ),
  );
};
