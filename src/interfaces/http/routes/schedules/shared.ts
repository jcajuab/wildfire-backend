import { type Hono } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import {
  type AdminDisplayLifecycleEventPublisher,
  type DisplayStreamEventPublisher,
} from "#/application/ports/display-stream-events";
import {
  type DisplayGroupRepository,
  type DisplayRepository,
} from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type AuthorizationRepository } from "#/application/ports/rbac";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { type ListContentOptionsUseCase } from "#/application/use-cases/content";
import {
  type ListDisplayGroupsUseCase,
  type ListDisplayOptionsUseCase,
} from "#/application/use-cases/displays";
import { type ListPlaylistOptionsUseCase } from "#/application/use-cases/playlists";
import { type CheckPermissionUseCase } from "#/application/use-cases/rbac";
import {
  type CreateScheduleUseCase,
  type DeleteScheduleUseCase,
  type GetMergedPlaylistUseCase,
  type GetScheduleUseCase,
  type ListSchedulesUseCase,
  type ListScheduleWindowUseCase,
  type UpdateScheduleUseCase,
} from "#/application/use-cases/schedules";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { type AuthorizePermission } from "#/interfaces/http/routes/shared/error-handling";

export interface SchedulesRouterDeps {
  jwtSecret: string;
  authSessionRepository: AuthSessionRepository;
  authSessionCookieName: string;
  timezone: string;
  repositories: {
    scheduleRepository: ScheduleRepository;
    playlistRepository: PlaylistRepository;
    displayRepository: DisplayRepository;
    displayGroupRepository?: DisplayGroupRepository;
    contentRepository: ContentRepository;
    authorizationRepository: AuthorizationRepository;
  };
  contentStorage: ContentStorage;
  thumbnailUrlExpiresInSeconds: number;
  displayEventPublisher: DisplayStreamEventPublisher;
  adminLifecycleEventPublisher?: AdminDisplayLifecycleEventPublisher;
  checkPermissionUseCase: CheckPermissionUseCase;
}

export interface SchedulesRouterUseCases {
  listSchedules: ListSchedulesUseCase;
  listScheduleWindow: ListScheduleWindowUseCase;
  createSchedule: CreateScheduleUseCase;
  getSchedule: GetScheduleUseCase;
  updateSchedule: UpdateScheduleUseCase;
  deleteSchedule: DeleteScheduleUseCase;
  getMergedPlaylist: GetMergedPlaylistUseCase;
  listDisplayOptions: ListDisplayOptionsUseCase;
  /**
   * Null when no displayGroupRepository is wired (e.g. deployments without group support).
   * Callers must guard: `useCases.listDisplayGroups?.execute() ?? Promise.resolve([])`.
   */
  listDisplayGroups: ListDisplayGroupsUseCase | null;
  listPlaylistOptions: ListPlaylistOptionsUseCase;
  listFlashContentOptions: ListContentOptionsUseCase;
}

export type SchedulesRouter = Hono<{ Variables: JwtUserVariables }>;

export type { AuthorizePermission };

export const scheduleTags = ["Schedules"];
