import { type Hono, type MiddlewareHandler } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
import { type ContentRepository } from "#/application/ports/content";
import { type DeviceRepository } from "#/application/ports/devices";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type AuthorizationRepository } from "#/application/ports/rbac";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  CreateScheduleUseCase,
  DeleteScheduleUseCase,
  GetScheduleUseCase,
  ListSchedulesUseCase,
  UpdateScheduleUseCase,
} from "#/application/use-cases/schedules";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { publishDeviceStreamEvent } from "#/interfaces/http/routes/devices/stream";

export interface SchedulesRouterDeps {
  jwtSecret: string;
  authSessionRepository?: AuthSessionRepository;
  authSessionCookieName?: string;
  authSessionDualMode?: boolean;
  repositories: {
    scheduleRepository: ScheduleRepository;
    playlistRepository: PlaylistRepository;
    deviceRepository: DeviceRepository;
    contentRepository: ContentRepository;
    authorizationRepository: AuthorizationRepository;
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
  const deviceEventPublisher = {
    publish(input: {
      type:
        | "manifest_updated"
        | "schedule_updated"
        | "playlist_updated"
        | "device_refresh_requested";
      deviceId: string;
      reason?: string;
      timestamp?: string;
    }) {
      publishDeviceStreamEvent({
        type: input.type,
        deviceId: input.deviceId,
        reason: input.reason,
        timestamp: input.timestamp ?? new Date().toISOString(),
      });
    },
  };

  return {
    listSchedules: new ListSchedulesUseCase({
      scheduleRepository: deps.repositories.scheduleRepository,
      playlistRepository: deps.repositories.playlistRepository,
      deviceRepository: deps.repositories.deviceRepository,
    }),
    createSchedule: new CreateScheduleUseCase({
      scheduleRepository: deps.repositories.scheduleRepository,
      playlistRepository: deps.repositories.playlistRepository,
      deviceRepository: deps.repositories.deviceRepository,
      contentRepository: deps.repositories.contentRepository,
      deviceEventPublisher,
    }),
    getSchedule: new GetScheduleUseCase({
      scheduleRepository: deps.repositories.scheduleRepository,
      playlistRepository: deps.repositories.playlistRepository,
      deviceRepository: deps.repositories.deviceRepository,
    }),
    updateSchedule: new UpdateScheduleUseCase({
      scheduleRepository: deps.repositories.scheduleRepository,
      playlistRepository: deps.repositories.playlistRepository,
      deviceRepository: deps.repositories.deviceRepository,
      contentRepository: deps.repositories.contentRepository,
      deviceEventPublisher,
    }),
    deleteSchedule: new DeleteScheduleUseCase({
      scheduleRepository: deps.repositories.scheduleRepository,
      playlistRepository: deps.repositories.playlistRepository,
      deviceEventPublisher,
    }),
  };
};
