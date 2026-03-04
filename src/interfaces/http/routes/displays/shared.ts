import { type Hono } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import {
  type DisplayKeyRepository,
  type DisplayPairingSessionRepository,
} from "#/application/ports/display-auth";
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
  GetDisplayUseCase,
  ListDisplayGroupsUseCase,
  ListDisplaysUseCase,
  RequestDisplayRefreshUseCase,
  SetDisplayGroupsUseCase,
  UnregisterDisplayUseCase,
  UpdateDisplayGroupUseCase,
  UpdateDisplayUseCase,
} from "#/application/use-cases/displays";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { publishAdminDisplayLifecycleEvent } from "./admin-lifecycle-events";
import { publishDisplayStreamEvent } from "./stream";

export interface DisplaysRouterDeps {
  jwtSecret: string;
  authSessionRepository: AuthSessionRepository;
  authSessionCookieName: string;
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
    displayPairingSessionRepository: DisplayPairingSessionRepository;
    displayKeyRepository: DisplayKeyRepository;
    systemSettingRepository: SystemSettingRepository;
  };
  storage: ContentStorage;
}

export interface DisplaysRouterUseCases {
  listDisplays: ListDisplaysUseCase;
  getDisplay: GetDisplayUseCase;
  updateDisplay: UpdateDisplayUseCase;
  listDisplayGroups: ListDisplayGroupsUseCase;
  createDisplayGroup: CreateDisplayGroupUseCase;
  updateDisplayGroup: UpdateDisplayGroupUseCase;
  deleteDisplayGroup: DeleteDisplayGroupUseCase;
  setDisplayGroups: SetDisplayGroupsUseCase;
  requestDisplayRefresh: RequestDisplayRefreshUseCase;
  unregisterDisplay: UnregisterDisplayUseCase;
}

export type DisplaysRouter = Hono<{ Variables: JwtUserVariables }>;

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
      playlistRepository: deps.repositories.playlistRepository,
      scheduleTimeZone: deps.scheduleTimeZone,
    }),
    getDisplay: new GetDisplayUseCase({
      displayRepository: deps.repositories.displayRepository,
      scheduleRepository: deps.repositories.scheduleRepository,
      playlistRepository: deps.repositories.playlistRepository,
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
    unregisterDisplay: new UnregisterDisplayUseCase({
      displayRepository: deps.repositories.displayRepository,
      displayKeyRepository: deps.repositories.displayKeyRepository,
      lifecycleEventPublisher: {
        publish(input) {
          publishAdminDisplayLifecycleEvent({
            type: input.type,
            displayId: input.displayId,
            displaySlug: input.displaySlug,
            occurredAt: input.occurredAt,
          });
        },
      },
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
  };
};
