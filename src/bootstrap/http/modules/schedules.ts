import { CheckPermissionUseCase } from "#/application/use-cases/rbac";
import {
  CreateScheduleUseCase,
  DeleteScheduleUseCase,
  GetScheduleUseCase,
  ListSchedulesUseCase,
  ListScheduleWindowUseCase,
  UpdateScheduleUseCase,
} from "#/application/use-cases/schedules";
import {
  type SchedulesRouterDeps,
  type SchedulesRouterUseCases,
} from "#/interfaces/http/routes/schedules/shared";

export interface SchedulesHttpModule {
  deps: SchedulesRouterDeps;
  useCases: SchedulesRouterUseCases;
}

export const createSchedulesHttpModule = (
  deps: Omit<SchedulesRouterDeps, "checkPermissionUseCase">,
): SchedulesHttpModule => {
  const routerDeps: SchedulesRouterDeps = {
    ...deps,
    checkPermissionUseCase: new CheckPermissionUseCase({
      authorizationRepository: deps.repositories.authorizationRepository,
    }),
  };

  return {
    deps: routerDeps,
    useCases: {
      listSchedules: new ListSchedulesUseCase({
        scheduleRepository: routerDeps.repositories.scheduleRepository,
        playlistRepository: routerDeps.repositories.playlistRepository,
        contentRepository: routerDeps.repositories.contentRepository,
        displayRepository: routerDeps.repositories.displayRepository,
      }),
      listScheduleWindow: new ListScheduleWindowUseCase({
        scheduleRepository: routerDeps.repositories.scheduleRepository,
        playlistRepository: routerDeps.repositories.playlistRepository,
        contentRepository: routerDeps.repositories.contentRepository,
        displayRepository: routerDeps.repositories.displayRepository,
      }),
      createSchedule: new CreateScheduleUseCase({
        scheduleRepository: routerDeps.repositories.scheduleRepository,
        playlistRepository: routerDeps.repositories.playlistRepository,
        displayRepository: routerDeps.repositories.displayRepository,
        contentRepository: routerDeps.repositories.contentRepository,
        displayEventPublisher: routerDeps.displayEventPublisher,
      }),
      getSchedule: new GetScheduleUseCase({
        scheduleRepository: routerDeps.repositories.scheduleRepository,
        playlistRepository: routerDeps.repositories.playlistRepository,
        contentRepository: routerDeps.repositories.contentRepository,
        displayRepository: routerDeps.repositories.displayRepository,
      }),
      updateSchedule: new UpdateScheduleUseCase({
        scheduleRepository: routerDeps.repositories.scheduleRepository,
        playlistRepository: routerDeps.repositories.playlistRepository,
        displayRepository: routerDeps.repositories.displayRepository,
        contentRepository: routerDeps.repositories.contentRepository,
        displayEventPublisher: routerDeps.displayEventPublisher,
      }),
      deleteSchedule: new DeleteScheduleUseCase({
        scheduleRepository: routerDeps.repositories.scheduleRepository,
        playlistRepository: routerDeps.repositories.playlistRepository,
        contentRepository: routerDeps.repositories.contentRepository,
        displayEventPublisher: routerDeps.displayEventPublisher,
      }),
    },
  };
};
