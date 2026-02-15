import { describeRoute, resolver } from "hono-openapi";
import { NotFoundError } from "#/application/use-cases/schedules";
import { setAction } from "#/interfaces/http/middleware/observability";
import { errorResponseSchema, notFound } from "#/interfaces/http/responses";
import {
  scheduleIdParamSchema,
  scheduleListResponseSchema,
  scheduleSchema,
} from "#/interfaces/http/validators/schedules.schema";
import { validateParams } from "#/interfaces/http/validators/standard-validator";
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
    async (c) => {
      const items = await useCases.listSchedules.execute();
      return c.json({ items });
    },
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
              schema: resolver(scheduleSchema),
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
    async (c) => {
      const params = c.req.valid("param");
      c.set("resourceId", params.id);
      try {
        const result = await useCases.getSchedule.execute({ id: params.id });
        return c.json(result);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );
};
