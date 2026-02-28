import { describeRoute, resolver } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  errorResponseSchema,
  toApiListResponse,
} from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  scheduleIdParamSchema,
  scheduleListQuerySchema,
  scheduleListResponseSchema,
  scheduleSchema,
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
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const result = await useCases.getSchedule.execute({ id: params.id });
        return c.json(result);
      },
      ...applicationErrorMappers,
    ),
  );
};
