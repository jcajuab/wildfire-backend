import { type Hono, type MiddlewareHandler } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
import { type ContentRepository } from "#/application/ports/content";
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
  type ListPlaylistsUseCase,
  type ReorderPlaylistItemsUseCase,
  type ReplacePlaylistItemsAtomicUseCase,
  type UpdatePlaylistItemUseCase,
  type UpdatePlaylistUseCase,
} from "#/application/use-cases/playlists";
import { type CheckPermissionUseCase } from "#/application/use-cases/rbac";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";

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
  displayEventPublisher: DisplayStreamEventPublisher;
  checkPermissionUseCase: CheckPermissionUseCase;
}

export interface PlaylistsRouterUseCases {
  listPlaylists: ListPlaylistsUseCase;
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

export type AuthorizePermission = (
  permission: string,
) => readonly [
  MiddlewareHandler,
  MiddlewareHandler<{ Variables: JwtUserVariables }>,
];

export const playlistTags = ["Playlists"];
