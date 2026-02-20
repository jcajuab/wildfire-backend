import { type Hono, type MiddlewareHandler } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
import { type ContentRepository } from "#/application/ports/content";
import { type DeviceRepository } from "#/application/ports/devices";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type AuthorizationRepository } from "#/application/ports/rbac";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { type SystemSettingRepository } from "#/application/ports/settings";
import {
  CreateScheduleUseCase,
  DeleteScheduleSeriesUseCase,
  DeleteScheduleUseCase,
  GetScheduleUseCase,
  ListSchedulesUseCase,
  UpdateScheduleSeriesUseCase,
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
    systemSettingRepository: SystemSettingRepository;
  };
}

export interface SchedulesRouterUseCases {
  listSchedules: ListSchedulesUseCase;
  createSchedule: CreateScheduleUseCase;
  getSchedule: GetScheduleUseCase;
  updateSchedule: UpdateScheduleUseCase;
  updateScheduleSeries: UpdateScheduleSeriesUseCase;
  deleteSchedule: DeleteScheduleUseCase;
  deleteScheduleSeries: DeleteScheduleSeriesUseCase;
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
      systemSettingRepository: deps.repositories.systemSettingRepository,
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
      systemSettingRepository: deps.repositories.systemSettingRepository,
      deviceEventPublisher,
    }),
    updateScheduleSeries: new UpdateScheduleSeriesUseCase({
      scheduleRepository: deps.repositories.scheduleRepository,
      playlistRepository: deps.repositories.playlistRepository,
      deviceRepository: deps.repositories.deviceRepository,
      contentRepository: deps.repositories.contentRepository,
      systemSettingRepository: deps.repositories.systemSettingRepository,
      deviceEventPublisher,
    }),
    deleteSchedule: new DeleteScheduleUseCase({
      scheduleRepository: deps.repositories.scheduleRepository,
      playlistRepository: deps.repositories.playlistRepository,
      deviceEventPublisher,
    }),
    deleteScheduleSeries: new DeleteScheduleSeriesUseCase({
      scheduleRepository: deps.repositories.scheduleRepository,
      playlistRepository: deps.repositories.playlistRepository,
      deviceEventPublisher,
    }),
  };
};
