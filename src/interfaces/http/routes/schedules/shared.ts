import { type Hono, type MiddlewareHandler } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
import { type ContentRepository } from "#/application/ports/content";
import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import { type DisplayRepository } from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type AuthorizationRepository } from "#/application/ports/rbac";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { type CheckPermissionUseCase } from "#/application/use-cases/rbac";
import {
  type CreateScheduleUseCase,
  type DeleteScheduleUseCase,
  type GetScheduleUseCase,
  type ListSchedulesUseCase,
  type UpdateScheduleUseCase,
} from "#/application/use-cases/schedules";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";

export interface SchedulesRouterDeps {
  jwtSecret: string;
  authSessionRepository: AuthSessionRepository;
  authSessionCookieName: string;
  repositories: {
    scheduleRepository: ScheduleRepository;
    playlistRepository: PlaylistRepository;
    displayRepository: DisplayRepository;
    contentRepository: ContentRepository;
    authorizationRepository: AuthorizationRepository;
  };
  displayEventPublisher: DisplayStreamEventPublisher;
  checkPermissionUseCase: CheckPermissionUseCase;
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
