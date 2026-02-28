import { timingSafeEqual } from "node:crypto";
import { type Hono, type MiddlewareHandler } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { type DisplayPairingCodeRepository } from "#/application/ports/display-pairing";
import {
  type DisplayGroupRepository,
  type DisplayRepository,
} from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type AuthorizationRepository } from "#/application/ports/rbac";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { type SystemSettingRepository } from "#/application/ports/settings";
import {
  CreateDisplayGroupUseCase,
  DeleteDisplayGroupUseCase,
  GetDisplayActiveScheduleUseCase,
  GetDisplayManifestUseCase,
  GetDisplayUseCase,
  IssueDisplayPairingCodeUseCase,
  ListDisplayGroupsUseCase,
  ListDisplaysUseCase,
  RegisterDisplayUseCase,
  RequestDisplayRefreshUseCase,
  SetDisplayGroupsUseCase,
  UpdateDisplayGroupUseCase,
  UpdateDisplayUseCase,
} from "#/application/use-cases/displays";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { unauthorized } from "#/interfaces/http/responses";
import { publishDisplayStreamEvent } from "./stream";

export interface DisplaysRouterDeps {
  jwtSecret: string;
  authSessionRepository?: AuthSessionRepository;
  authSessionCookieName?: string;
  authSessionDualMode?: boolean;
  displayApiKey: string;
  downloadUrlExpiresInSeconds: number;
  scheduleTimeZone?: string;
  repositories: {
    displayRepository: DisplayRepository;
    scheduleRepository: ScheduleRepository;
    playlistRepository: PlaylistRepository;
    contentRepository: ContentRepository;
    authorizationRepository: AuthorizationRepository;
    displayGroupRepository: DisplayGroupRepository;
    displayPairingCodeRepository: DisplayPairingCodeRepository;
    systemSettingRepository: SystemSettingRepository;
  };
  storage: ContentStorage;
}

export interface DisplaysRouterUseCases {
  listDisplays: ListDisplaysUseCase;
  getDisplay: GetDisplayUseCase;
  updateDisplay: UpdateDisplayUseCase;
  registerDisplay: RegisterDisplayUseCase;
  issuePairingCode: IssueDisplayPairingCodeUseCase;
  listDisplayGroups: ListDisplayGroupsUseCase;
  createDisplayGroup: CreateDisplayGroupUseCase;
  updateDisplayGroup: UpdateDisplayGroupUseCase;
  deleteDisplayGroup: DeleteDisplayGroupUseCase;
  setDisplayGroups: SetDisplayGroupsUseCase;
  getActiveSchedule: GetDisplayActiveScheduleUseCase;
  getManifest: GetDisplayManifestUseCase;
  requestDisplayRefresh: RequestDisplayRefreshUseCase;
}

export type DisplaysRouter = Hono<{ Variables: JwtUserVariables }>;

export type DisplayAuthMiddleware = MiddlewareHandler<{
  Variables: JwtUserVariables;
}>;

export const displayTags = ["Displays"];

export const createDisplaysUseCases = (
  deps: DisplaysRouterDeps,
): DisplaysRouterUseCases => {
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
    listDisplays: new ListDisplaysUseCase({
      displayRepository: deps.repositories.displayRepository,
      scheduleRepository: deps.repositories.scheduleRepository,
      scheduleTimeZone: deps.scheduleTimeZone,
    }),
    getDisplay: new GetDisplayUseCase({
      displayRepository: deps.repositories.displayRepository,
      scheduleRepository: deps.repositories.scheduleRepository,
      scheduleTimeZone: deps.scheduleTimeZone,
    }),
    updateDisplay: new UpdateDisplayUseCase({
      displayRepository: deps.repositories.displayRepository,
      scheduleRepository: deps.repositories.scheduleRepository,
      scheduleTimeZone: deps.scheduleTimeZone,
    }),
    requestDisplayRefresh: new RequestDisplayRefreshUseCase({
      displayRepository: deps.repositories.displayRepository,
      displayEventPublisher,
    }),
    registerDisplay: new RegisterDisplayUseCase({
      displayRepository: deps.repositories.displayRepository,
      displayPairingCodeRepository:
        deps.repositories.displayPairingCodeRepository,
    }),
    issuePairingCode: new IssueDisplayPairingCodeUseCase({
      displayPairingCodeRepository:
        deps.repositories.displayPairingCodeRepository,
    }),
    listDisplayGroups: new ListDisplayGroupsUseCase({
      displayGroupRepository: deps.repositories.displayGroupRepository,
    }),
    createDisplayGroup: new CreateDisplayGroupUseCase({
      displayGroupRepository: deps.repositories.displayGroupRepository,
    }),
    updateDisplayGroup: new UpdateDisplayGroupUseCase({
      displayGroupRepository: deps.repositories.displayGroupRepository,
    }),
    deleteDisplayGroup: new DeleteDisplayGroupUseCase({
      displayGroupRepository: deps.repositories.displayGroupRepository,
    }),
    setDisplayGroups: new SetDisplayGroupsUseCase({
      displayRepository: deps.repositories.displayRepository,
      displayGroupRepository: deps.repositories.displayGroupRepository,
    }),
    getActiveSchedule: new GetDisplayActiveScheduleUseCase({
      scheduleRepository: deps.repositories.scheduleRepository,
      playlistRepository: deps.repositories.playlistRepository,
      displayRepository: deps.repositories.displayRepository,
      scheduleTimeZone: deps.scheduleTimeZone,
    }),
    getManifest: new GetDisplayManifestUseCase({
      scheduleRepository: deps.repositories.scheduleRepository,
      playlistRepository: deps.repositories.playlistRepository,
      contentRepository: deps.repositories.contentRepository,
      contentStorage: deps.storage,
      displayRepository: deps.repositories.displayRepository,
      systemSettingRepository: deps.repositories.systemSettingRepository,
      downloadUrlExpiresInSeconds: deps.downloadUrlExpiresInSeconds,
      scheduleTimeZone: deps.scheduleTimeZone,
    }),
  };
};

const safeCompare = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

export const createRequireDisplayApiKey = (
  apiKey: string,
): DisplayAuthMiddleware => {
  return async (c, next) => {
    const header = c.req.header("x-api-key");
    if (!header || !safeCompare(header, apiKey)) {
      return unauthorized(c, "Invalid API key");
    }
    await next();
  };
};
