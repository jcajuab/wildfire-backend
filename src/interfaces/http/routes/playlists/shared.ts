import { type Hono, type MiddlewareHandler } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
import { type ContentRepository } from "#/application/ports/content";
import { type PlaylistRepository } from "#/application/ports/playlists";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import {
  AddPlaylistItemUseCase,
  CreatePlaylistUseCase,
  DeletePlaylistItemUseCase,
  DeletePlaylistUseCase,
  GetPlaylistUseCase,
  ListPlaylistsUseCase,
  UpdatePlaylistItemUseCase,
  UpdatePlaylistUseCase,
} from "#/application/use-cases/playlists";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";

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
): PlaylistsRouterUseCases => ({
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
  }),
  addPlaylistItem: new AddPlaylistItemUseCase({
    playlistRepository: deps.repositories.playlistRepository,
    contentRepository: deps.repositories.contentRepository,
  }),
  updatePlaylistItem: new UpdatePlaylistItemUseCase({
    playlistRepository: deps.repositories.playlistRepository,
    contentRepository: deps.repositories.contentRepository,
  }),
  deletePlaylistItem: new DeletePlaylistItemUseCase({
    playlistRepository: deps.repositories.playlistRepository,
  }),
});
