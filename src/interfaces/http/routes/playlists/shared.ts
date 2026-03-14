import { type Hono } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import { type DisplayRepository } from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  type AddPlaylistItemUseCase,
  type CreatePlaylistUseCase,
  type DeletePlaylistItemUseCase,
  type DeletePlaylistUseCase,
  type EstimatePlaylistDurationUseCase,
  type GetPlaylistUseCase,
  type ListPlaylistOptionsUseCase,
  type ListPlaylistsUseCase,
  type ReorderPlaylistItemsUseCase,
  type ReplacePlaylistItemsAtomicUseCase,
  type UpdatePlaylistItemUseCase,
  type UpdatePlaylistUseCase,
} from "#/application/use-cases/playlists";
import { type CheckPermissionUseCase } from "#/application/use-cases/rbac";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { type AuthorizePermission } from "#/interfaces/http/routes/shared/error-handling";

export interface PlaylistsRouterDeps {
  jwtSecret: string;
  authSessionRepository: AuthSessionRepository;
  authSessionCookieName: string;
  repositories: {
    playlistRepository: PlaylistRepository;
    contentRepository: ContentRepository;
    userRepository: UserRepository;
    authorizationRepository: AuthorizationRepository;
    scheduleRepository: ScheduleRepository;
    displayRepository: DisplayRepository;
  };
  storage: ContentStorage;
  thumbnailUrlExpiresInSeconds: number;
  displayEventPublisher: DisplayStreamEventPublisher;
  checkPermissionUseCase: CheckPermissionUseCase;
}

export interface PlaylistsRouterUseCases {
  listPlaylists: ListPlaylistsUseCase;
  listPlaylistOptions: ListPlaylistOptionsUseCase;
  createPlaylist: CreatePlaylistUseCase;
  getPlaylist: GetPlaylistUseCase;
  updatePlaylist: UpdatePlaylistUseCase;
  deletePlaylist: DeletePlaylistUseCase;
  estimatePlaylistDuration: EstimatePlaylistDurationUseCase;
  addPlaylistItem: AddPlaylistItemUseCase;
  updatePlaylistItem: UpdatePlaylistItemUseCase;
  replacePlaylistItemsAtomic: ReplacePlaylistItemsAtomicUseCase;
  reorderPlaylistItems: ReorderPlaylistItemsUseCase;
  deletePlaylistItem: DeletePlaylistItemUseCase;
}

export type PlaylistsRouter = Hono<{ Variables: JwtUserVariables }>;

export type { AuthorizePermission };

export const playlistTags = ["Playlists"];
