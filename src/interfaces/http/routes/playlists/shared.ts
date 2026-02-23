import { type Hono, type MiddlewareHandler } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
import { type ContentRepository } from "#/application/ports/content";
import { type DeviceRepository } from "#/application/ports/devices";
import { type PlaylistRepository } from "#/application/ports/playlists";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { type SystemSettingRepository } from "#/application/ports/settings";
import {
  AddPlaylistItemUseCase,
  CreatePlaylistUseCase,
  DeletePlaylistItemUseCase,
  DeletePlaylistUseCase,
  GetPlaylistUseCase,
  ListPlaylistsUseCase,
  ReorderPlaylistItemsUseCase,
  UpdatePlaylistItemUseCase,
  UpdatePlaylistUseCase,
} from "#/application/use-cases/playlists";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { publishDeviceStreamEvent } from "#/interfaces/http/routes/devices/stream";

export interface PlaylistsRouterDeps {
  jwtSecret: string;
  authSessionRepository?: AuthSessionRepository;
  authSessionCookieName?: string;
  authSessionDualMode?: boolean;
  repositories: {
    playlistRepository: PlaylistRepository;
    contentRepository: ContentRepository;
    userRepository: UserRepository;
    authorizationRepository: AuthorizationRepository;
    scheduleRepository: ScheduleRepository;
    deviceRepository: DeviceRepository;
    systemSettingRepository: SystemSettingRepository;
  };
}

export interface PlaylistsRouterUseCases {
  listPlaylists: ListPlaylistsUseCase;
  createPlaylist: CreatePlaylistUseCase;
  getPlaylist: GetPlaylistUseCase;
  updatePlaylist: UpdatePlaylistUseCase;
  deletePlaylist: DeletePlaylistUseCase;
  addPlaylistItem: AddPlaylistItemUseCase;
  updatePlaylistItem: UpdatePlaylistItemUseCase;
  reorderPlaylistItems: ReorderPlaylistItemsUseCase;
  deletePlaylistItem: DeletePlaylistItemUseCase;
}

export type PlaylistsRouter = Hono<{ Variables: JwtUserVariables }>;

export type AuthorizePermission = (
  permission: string,
) => readonly [
  MiddlewareHandler,
  MiddlewareHandler<{ Variables: JwtUserVariables }>,
];

export const playlistTags = ["Playlists"];

export const createPlaylistsUseCases = (
  deps: PlaylistsRouterDeps,
): PlaylistsRouterUseCases => {
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
    listPlaylists: new ListPlaylistsUseCase({
      playlistRepository: deps.repositories.playlistRepository,
      userRepository: deps.repositories.userRepository,
    }),
    createPlaylist: new CreatePlaylistUseCase({
      playlistRepository: deps.repositories.playlistRepository,
      userRepository: deps.repositories.userRepository,
    }),
    getPlaylist: new GetPlaylistUseCase({
      playlistRepository: deps.repositories.playlistRepository,
      contentRepository: deps.repositories.contentRepository,
      userRepository: deps.repositories.userRepository,
    }),
    updatePlaylist: new UpdatePlaylistUseCase({
      playlistRepository: deps.repositories.playlistRepository,
      userRepository: deps.repositories.userRepository,
    }),
    deletePlaylist: new DeletePlaylistUseCase({
      playlistRepository: deps.repositories.playlistRepository,
      contentRepository: deps.repositories.contentRepository,
      scheduleRepository: deps.repositories.scheduleRepository,
      deviceRepository: deps.repositories.deviceRepository,
    }),
    addPlaylistItem: new AddPlaylistItemUseCase({
      playlistRepository: deps.repositories.playlistRepository,
      contentRepository: deps.repositories.contentRepository,
      scheduleRepository: deps.repositories.scheduleRepository,
      deviceRepository: deps.repositories.deviceRepository,
      systemSettingRepository: deps.repositories.systemSettingRepository,
      deviceEventPublisher,
    }),
    updatePlaylistItem: new UpdatePlaylistItemUseCase({
      playlistRepository: deps.repositories.playlistRepository,
      contentRepository: deps.repositories.contentRepository,
      scheduleRepository: deps.repositories.scheduleRepository,
      deviceRepository: deps.repositories.deviceRepository,
      systemSettingRepository: deps.repositories.systemSettingRepository,
      deviceEventPublisher,
    }),
    reorderPlaylistItems: new ReorderPlaylistItemsUseCase({
      playlistRepository: deps.repositories.playlistRepository,
      contentRepository: deps.repositories.contentRepository,
      scheduleRepository: deps.repositories.scheduleRepository,
      deviceRepository: deps.repositories.deviceRepository,
      systemSettingRepository: deps.repositories.systemSettingRepository,
      deviceEventPublisher,
    }),
    deletePlaylistItem: new DeletePlaylistItemUseCase({
      playlistRepository: deps.repositories.playlistRepository,
      contentRepository: deps.repositories.contentRepository,
      scheduleRepository: deps.repositories.scheduleRepository,
      deviceRepository: deps.repositories.deviceRepository,
      systemSettingRepository: deps.repositories.systemSettingRepository,
      deviceEventPublisher,
    }),
  };
};
