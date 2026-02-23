import { describeRoute, resolver } from "hono-openapi";
import { ScheduleConflictError } from "#/application/use-cases/schedules";
import { setAction } from "#/interfaces/http/middleware/observability";
import { conflict, errorResponseSchema } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  mapErrorToResponse,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  createScheduleSchema,
  scheduleIdParamSchema,
  scheduleItemsResponseSchema,
  scheduleSchema,
  scheduleSeriesIdParamSchema,
  updateScheduleSchema,
  updateScheduleSeriesSchema,
} from "#/interfaces/http/validators/schedules.schema";
import {
  validateJson,
  validateParams,
} from "#/interfaces/http/validators/standard-validator";
import {
  type AuthorizePermission,
  type SchedulesRouter,
  type SchedulesRouterUseCases,
  scheduleTags,
} from "./shared";

export const registerScheduleCommandRoutes = (args: {
  router: SchedulesRouter;
  useCases: SchedulesRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = args;

  router.post(
    "/",
    setAction("schedules.schedule.create", {
      route: "/schedules",
      resourceType: "schedule",
    }),
    ...authorize("schedules:create"),
    validateJson(createScheduleSchema),
    describeRoute({
      description: "Create schedule",
      tags: scheduleTags,
      responses: {
        201: {
          description: "Schedule entries created",
          content: {
            "application/json": {
              schema: resolver(scheduleItemsResponseSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const result = await useCases.createSchedule.execute({
          name: payload.name,
          playlistId: payload.playlistId,
          deviceId: payload.deviceId,
          startDate: payload.startDate,
          endDate: payload.endDate,
          startTime: payload.startTime,
          endTime: payload.endTime,
          daysOfWeek: payload.daysOfWeek,
          priority: payload.priority,
          isActive: payload.isActive ?? true,
        });
        if (result[0]) {
          c.set("resourceId", result[0].id);
        }
        return c.json({ items: result }, 201);
      },
      mapErrorToResponse(ScheduleConflictError, conflict),
      ...applicationErrorMappers,
    ),
  );

  router.patch(
    "/:id",
    setAction("schedules.schedule.update", {
      route: "/schedules/:id",
      resourceType: "schedule",
    }),
    ...authorize("schedules:update"),
    validateParams(scheduleIdParamSchema),
    validateJson(updateScheduleSchema),
    describeRoute({
      description: "Update schedule",
      tags: scheduleTags,
      responses: {
        200: {
          description: "Schedule updated",
          content: {
            "application/json": {
              schema: resolver(scheduleSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const payload = c.req.valid("json");
        const result = await useCases.updateSchedule.execute({
          id: params.id,
          name: payload.name,
          playlistId: payload.playlistId,
          deviceId: payload.deviceId,
          startDate: payload.startDate,
          endDate: payload.endDate,
          startTime: payload.startTime,
          endTime: payload.endTime,
          dayOfWeek: payload.dayOfWeek,
          priority: payload.priority,
          isActive: payload.isActive,
        });
        return c.json(result);
      },
      mapErrorToResponse(ScheduleConflictError, conflict),
      ...applicationErrorMappers,
    ),
  );

  router.patch(
    "/series/:seriesId",
    setAction("schedules.schedule-series.update", {
      route: "/schedules/series/:seriesId",
      resourceType: "schedule",
    }),
    ...authorize("schedules:update"),
    validateParams(scheduleSeriesIdParamSchema),
    validateJson(updateScheduleSeriesSchema),
    describeRoute({
      description: "Update schedule series",
      tags: scheduleTags,
      responses: {
        200: {
          description: "Schedule series updated",
          content: {
            "application/json": {
              schema: resolver(scheduleItemsResponseSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.seriesId);
        const payload = c.req.valid("json");
        const result = await useCases.updateScheduleSeries.execute({
          seriesId: params.seriesId,
          name: payload.name,
          playlistId: payload.playlistId,
          deviceId: payload.deviceId,
          startDate: payload.startDate,
          endDate: payload.endDate,
          startTime: payload.startTime,
          endTime: payload.endTime,
          daysOfWeek: payload.daysOfWeek,
          priority: payload.priority,
          isActive: payload.isActive,
        });
        return c.json({ items: result });
      },
      mapErrorToResponse(ScheduleConflictError, conflict),
      ...applicationErrorMappers,
    ),
  );

  router.delete(
    "/:id",
    setAction("schedules.schedule.delete", {
      route: "/schedules/:id",
      resourceType: "schedule",
    }),
    ...authorize("schedules:delete"),
    validateParams(scheduleIdParamSchema),
    describeRoute({
      description: "Delete schedule",
      tags: scheduleTags,
      responses: {
        204: { description: "Deleted" },
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
        await useCases.deleteSchedule.execute({ id: params.id });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  router.delete(
    "/series/:seriesId",
    setAction("schedules.schedule-series.delete", {
      route: "/schedules/series/:seriesId",
      resourceType: "schedule",
    }),
    ...authorize("schedules:delete"),
    validateParams(scheduleSeriesIdParamSchema),
    describeRoute({
      description: "Delete schedule series",
      tags: scheduleTags,
      responses: {
        204: { description: "Deleted" },
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
        c.set("resourceId", params.seriesId);
        await useCases.deleteScheduleSeries.execute({
          seriesId: params.seriesId,
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
