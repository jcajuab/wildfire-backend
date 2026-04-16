import { describeRoute } from "hono-openapi";
import { ListContentOptionsUseCase } from "#/application/use-cases/content";
import {
  ListDisplayGroupsUseCase,
  ListDisplayOptionsUseCase,
} from "#/application/use-cases/displays";
import { ListPlaylistOptionsUseCase } from "#/application/use-cases/playlists";
import { logger } from "#/infrastructure/observability/logger";
import { setAction } from "#/interfaces/http/middleware/observability";
import { toApiResponse } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import { scheduleWindowQuerySchema } from "#/interfaces/http/validators/schedules.schema";
import { validateQuery } from "#/interfaces/http/validators/standard-validator";
import {
  type AuthorizePermission,
  type SchedulesRouter,
  type SchedulesRouterDeps,
  type SchedulesRouterUseCases,
  scheduleTags,
} from "./shared";

const hasPermission = (
  c: { get: (name: string) => unknown },
  permission: string,
): boolean => {
  const payload = c.get("jwtPayload") as
    | { isAdmin?: boolean; permissions?: string[] }
    | undefined;
  return (
    payload?.isAdmin === true ||
    payload?.permissions?.includes(permission) === true
  );
};

export const registerScheduleBootstrapRoutes = (args: {
  router: SchedulesRouter;
  deps: SchedulesRouterDeps;
  useCases: SchedulesRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, deps, useCases, authorize } = args;
  const listDisplayOptionsUseCase = new ListDisplayOptionsUseCase({
    displayRepository: deps.repositories.displayRepository,
  });
  const listDisplayGroupsUseCase =
    deps.repositories.displayGroupRepository != null
      ? new ListDisplayGroupsUseCase({
          displayGroupRepository: deps.repositories.displayGroupRepository,
        })
      : null;
  const listPlaylistOptionsUseCase = new ListPlaylistOptionsUseCase({
    playlistRepository: deps.repositories.playlistRepository,
  });
  const listFlashContentOptionsUseCase = new ListContentOptionsUseCase({
    contentRepository: deps.repositories.contentRepository,
  });

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
        const startedAt = Date.now();
        const query = c.req.valid("query");
        const canReadDisplays = hasPermission(c, "displays:read");
        const canReadPlaylists = hasPermission(c, "playlists:read");
        const canReadContent = hasPermission(c, "content:read");

        const [
          schedules,
          displayOptions,
          displayGroups,
          playlistOptions,
          flashContentOptions,
        ] = await Promise.all([
          useCases.listScheduleWindow.execute({
            ownerId: c.get("userId"),
            from: query.from,
            to: query.to,
            displayIds: query.displayIds,
          }),
          canReadDisplays
            ? listDisplayOptionsUseCase.execute({ limit: 100 })
            : Promise.resolve([]),
          canReadDisplays
            ? (listDisplayGroupsUseCase?.execute() ?? Promise.resolve([]))
            : Promise.resolve([]),
          canReadPlaylists
            ? listPlaylistOptionsUseCase.execute({
                ownerId: c.get("userId"),
              })
            : Promise.resolve([]),
          canReadContent
            ? listFlashContentOptionsUseCase.execute({
                ownerId: c.get("userId"),
                type: "FLASH",
                status: "READY",
              })
            : Promise.resolve([]),
        ]);

        logger.info(
          {
            event: "http.bootstrap.schedules.completed",
            durationMs: Date.now() - startedAt,
            scheduleCount: schedules.length,
          },
          "Schedules bootstrap completed",
        );

        return c.json(
          toApiResponse({
            schedules,
            displayOptions,
            displayGroups,
            playlistOptions,
            flashContentOptions,
          }),
        );
      },
      ...applicationErrorMappers,
    ),
  );
};
