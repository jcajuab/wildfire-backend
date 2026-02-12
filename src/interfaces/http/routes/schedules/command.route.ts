import { describeRoute, resolver } from "hono-openapi";
import { NotFoundError } from "#/application/use-cases/schedules";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  badRequest,
  errorResponseSchema,
  notFound,
} from "#/interfaces/http/responses";
import {
  createScheduleSchema,
  scheduleIdParamSchema,
  scheduleSchema,
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
              schema: resolver(scheduleSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const payload = createScheduleSchema.parse(c.req.valid("json"));
      try {
        const result = await useCases.createSchedule.execute({
          name: payload.name,
          playlistId: payload.playlistId,
          deviceId: payload.deviceId,
          startTime: payload.startTime,
          endTime: payload.endTime,
          daysOfWeek: payload.daysOfWeek,
          priority: payload.priority,
          isActive: payload.isActive ?? true,
        });
        c.set("resourceId", result.id);
        return c.json(result, 201);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        if (error instanceof Error) {
          return badRequest(c, error.message);
        }
        throw error;
      }
    },
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
    async (c) => {
      const params = c.req.valid("param");
      c.set("resourceId", params.id);
      const payload = updateScheduleSchema.parse(c.req.valid("json"));
      try {
        const result = await useCases.updateSchedule.execute({
          id: params.id,
          name: payload.name,
          playlistId: payload.playlistId,
          deviceId: payload.deviceId,
          startTime: payload.startTime,
          endTime: payload.endTime,
          daysOfWeek: payload.daysOfWeek,
          priority: payload.priority,
          isActive: payload.isActive,
        });
        return c.json(result);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        if (error instanceof Error) {
          return badRequest(c, error.message);
        }
        throw error;
      }
    },
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
    async (c) => {
      const params = c.req.valid("param");
      c.set("resourceId", params.id);
      try {
        await useCases.deleteSchedule.execute({ id: params.id });
        return c.body(null, 204);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );
};
