import { type Hono, type MiddlewareHandler } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
import { type ContentRepository } from "#/application/ports/content";
import { type DisplayRepository } from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type AuthorizationRepository } from "#/application/ports/rbac";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { type SystemSettingRepository } from "#/application/ports/settings";
import {
  CreateScheduleUseCase,
  DeleteScheduleUseCase,
  GetScheduleUseCase,
  ListSchedulesUseCase,
  UpdateScheduleUseCase,
} from "#/application/use-cases/schedules";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { publishDisplayStreamEvent } from "#/interfaces/http/routes/displays/stream";

export interface SchedulesRouterDeps {
  jwtSecret: string;
  authSessionRepository?: AuthSessionRepository;
  authSessionCookieName?: string;
  authSessionDualMode?: boolean;
  repositories: {
    scheduleRepository: ScheduleRepository;
    playlistRepository: PlaylistRepository;
    displayRepository: DisplayRepository;
    contentRepository: ContentRepository;
    authorizationRepository: AuthorizationRepository;
    systemSettingRepository: SystemSettingRepository;
  };
}

export interface SchedulesRouterUseCases {
  listSchedules: ListSchedulesUseCase;
  createSchedule: CreateScheduleUseCase;
  getSchedule: GetScheduleUseCase;
  updateSchedule: UpdateScheduleUseCase;
  deleteSchedule: DeleteScheduleUseCase;
}

export type SchedulesRouter = Hono<{ Variables: JwtUserVariables }>;

export type AuthorizePermission = (
  permission: string,
) => readonly [
  MiddlewareHandler,
  MiddlewareHandler<{ Variables: JwtUserVariables }>,
];

export const scheduleTags = ["Schedules"];

export const createSchedulesUseCases = (
  deps: SchedulesRouterDeps,
): SchedulesRouterUseCases => {
  const displayEventPublisher = {
    publish(input: {
      type:
        | "manifest_updated"
        | "schedule_updated"
        | "playlist_updated"
        | "display_refresh_requested";
      displayId: string;
      reason?: string;
      timestamp?: string;
    }) {
      publishDisplayStreamEvent({
        type: input.type,
        displayId: input.displayId,
        reason: input.reason,
        timestamp: input.timestamp ?? new Date().toISOString(),
      });
    },
  };

  return {
    listSchedules: new ListSchedulesUseCase({
      scheduleRepository: deps.repositories.scheduleRepository,
      playlistRepository: deps.repositories.playlistRepository,
      displayRepository: deps.repositories.displayRepository,
    }),
    createSchedule: new CreateScheduleUseCase({
      scheduleRepository: deps.repositories.scheduleRepository,
      playlistRepository: deps.repositories.playlistRepository,
      displayRepository: deps.repositories.displayRepository,
      contentRepository: deps.repositories.contentRepository,
      systemSettingRepository: deps.repositories.systemSettingRepository,
      displayEventPublisher,
    }),
    getSchedule: new GetScheduleUseCase({
      scheduleRepository: deps.repositories.scheduleRepository,
      playlistRepository: deps.repositories.playlistRepository,
      displayRepository: deps.repositories.displayRepository,
    }),
    updateSchedule: new UpdateScheduleUseCase({
      scheduleRepository: deps.repositories.scheduleRepository,
      playlistRepository: deps.repositories.playlistRepository,
      displayRepository: deps.repositories.displayRepository,
      contentRepository: deps.repositories.contentRepository,
      systemSettingRepository: deps.repositories.systemSettingRepository,
      displayEventPublisher,
    }),
    deleteSchedule: new DeleteScheduleUseCase({
      scheduleRepository: deps.repositories.scheduleRepository,
      playlistRepository: deps.repositories.playlistRepository,
      displayEventPublisher,
    }),
  };
};
