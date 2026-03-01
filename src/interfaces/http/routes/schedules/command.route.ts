import { describeRoute, resolver } from "hono-openapi";
import { ScheduleConflictError } from "#/application/use-cases/schedules";
import { setAction } from "#/interfaces/http/middleware/observability";
import { conflict, errorResponseSchema } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  mapErrorToResponse,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import { validationErrorResponse } from "#/interfaces/http/routes/shared/openapi-responses";
import {
  createScheduleSchema,
  scheduleIdParamSchema,
  scheduleResponseSchema,
  updateScheduleSchema,
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
          description: "Schedule created",
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
        409: {
          description: "Schedule overlaps an existing schedule",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        422: {
          ...validationErrorResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const result = await useCases.createSchedule.execute({
          name: payload.name,
          playlistId: payload.playlistId,
          displayId: payload.displayId,
          startDate: payload.startDate,
          endDate: payload.endDate,
          startTime: payload.startTime,
          endTime: payload.endTime,
          priority: payload.priority,
          isActive: payload.isActive ?? true,
        });
        c.set("resourceId", result.id);
        c.header("Location", `${c.req.path}/${encodeURIComponent(result.id)}`);
        return c.json({ data: result }, 201);
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
              schema: resolver(scheduleResponseSchema),
            },
          },
        },
        422: {
          ...validationErrorResponse,
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
          displayId: payload.displayId,
          startDate: payload.startDate,
          endDate: payload.endDate,
          startTime: payload.startTime,
          endTime: payload.endTime,
          priority: payload.priority,
          isActive: payload.isActive,
        });
        return c.json(result);
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
};
