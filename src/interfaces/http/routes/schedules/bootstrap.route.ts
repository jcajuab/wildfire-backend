import { describeRoute } from "hono-openapi";
import { logger } from "#/infrastructure/observability/logger";
import { jsonWithServerCache } from "#/interfaces/http/cache/server-cache";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import { getOwnerScope } from "#/interfaces/http/routes/shared/ownership";
import { scheduleWindowQuerySchema } from "#/interfaces/http/validators/schedules.schema";
import { validateQuery } from "#/interfaces/http/validators/standard-validator";
import {
  type AuthorizePermission,
  type SchedulesRouter,
  type SchedulesRouterDeps,
  type SchedulesRouterUseCases,
  scheduleTags,
} from "./shared";

export const registerScheduleBootstrapRoutes = (args: {
  router: SchedulesRouter;
  deps: SchedulesRouterDeps;
  useCases: SchedulesRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = args;

  router.get(
    "/bootstrap",
    setAction("schedules.schedule.bootstrap", {
      route: "/schedules/bootstrap",
    }),
    ...authorize("schedules:read"),
    validateQuery(scheduleWindowQuerySchema),
    describeRoute({
      description: "Get schedules page bootstrap data",
      tags: scheduleTags,
      responses: {
        200: { description: "Schedules bootstrap payload" },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const ownerId = getOwnerScope(c);
        return jsonWithServerCache(
          c,
          {
            domains: ["schedules", "displays", "playlists", "content"],
            ttl: "dynamic",
            varyByOwner: true,
          },
          async () => {
            const startedAt = Date.now();
            const query = c.req.valid("query");

            const [
              schedules,
              displayOptions,
              displayGroups,
              playlistOptions,
              flashContentOptions,
            ] = await Promise.all([
              useCases.listScheduleWindow.execute({
                from: query.from,
                to: query.to,
                displayIds: query.displayIds,
              }),
              useCases.listDisplayOptions.execute({ limit: 100 }),
              useCases.listDisplayGroups?.execute() ?? Promise.resolve([]),
              useCases.listPlaylistOptions.execute({ ownerId }),
              useCases.listFlashContentOptions.execute({
                ownerId,
                type: "FLASH",
                status: "READY",
              }),
            ]);

            logger.info(
              {
                event: "http.bootstrap.schedules.completed",
                durationMs: Date.now() - startedAt,
                scheduleCount: schedules.length,
              },
              "Schedules bootstrap completed",
            );

            return {
              data: {
                schedules,
                displayOptions,
                displayGroups,
                playlistOptions,
                flashContentOptions,
              },
            };
          },
        );
      },
      ...applicationErrorMappers,
    ),
  );
};
