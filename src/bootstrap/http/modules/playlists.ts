import {
  AddPlaylistItemUseCase,
  CreatePlaylistUseCase,
  DeletePlaylistItemUseCase,
  DeletePlaylistUseCase,
  EstimatePlaylistDurationUseCase,
  GetPlaylistUseCase,
  ListPlaylistOptionsUseCase,
  ListPlaylistsUseCase,
  ReorderPlaylistItemsUseCase,
  ReplacePlaylistItemsAtomicUseCase,
  UpdatePlaylistItemUseCase,
  UpdatePlaylistUseCase,
} from "#/application/use-cases/playlists";
import { CheckPermissionUseCase } from "#/application/use-cases/rbac";
import {
  type PlaylistsRouterDeps,
  type PlaylistsRouterUseCases,
} from "#/interfaces/http/routes/playlists/shared";

export interface PlaylistsHttpModule {
  deps: PlaylistsRouterDeps;
  useCases: PlaylistsRouterUseCases;
}

export const createPlaylistsHttpModule = (
  deps: Omit<PlaylistsRouterDeps, "checkPermissionUseCase">,
): PlaylistsHttpModule => {
  const routerDeps: PlaylistsRouterDeps = {
    ...deps,
    checkPermissionUseCase: new CheckPermissionUseCase({
      authorizationRepository: deps.repositories.authorizationRepository,
    }),
  };

  return {
    deps: routerDeps,
    useCases: {
      listPlaylists: new ListPlaylistsUseCase({
        playlistRepository: routerDeps.repositories.playlistRepository,
        contentRepository: routerDeps.repositories.contentRepository,
        userRepository: routerDeps.repositories.userRepository,
        contentStorage: routerDeps.storage,
        thumbnailUrlExpiresInSeconds: routerDeps.thumbnailUrlExpiresInSeconds,
      }),
      listPlaylistOptions: new ListPlaylistOptionsUseCase({
        playlistRepository: routerDeps.repositories.playlistRepository,
      }),
      createPlaylist: new CreatePlaylistUseCase({
        playlistRepository: routerDeps.repositories.playlistRepository,
        userRepository: routerDeps.repositories.userRepository,
      }),
      getPlaylist: new GetPlaylistUseCase({
        playlistRepository: routerDeps.repositories.playlistRepository,
        contentRepository: routerDeps.repositories.contentRepository,
        userRepository: routerDeps.repositories.userRepository,
        contentStorage: routerDeps.storage,
        thumbnailUrlExpiresInSeconds: routerDeps.thumbnailUrlExpiresInSeconds,
      }),
      updatePlaylist: new UpdatePlaylistUseCase({
        playlistRepository: routerDeps.repositories.playlistRepository,
        userRepository: routerDeps.repositories.userRepository,
      }),
      deletePlaylist: new DeletePlaylistUseCase({
        playlistRepository: routerDeps.repositories.playlistRepository,
        contentRepository: routerDeps.repositories.contentRepository,
        scheduleRepository: routerDeps.repositories.scheduleRepository,
        displayRepository: routerDeps.repositories.displayRepository,
      }),
      estimatePlaylistDuration: new EstimatePlaylistDurationUseCase({
        contentRepository: routerDeps.repositories.contentRepository,
        displayRepository: routerDeps.repositories.displayRepository,
      }),
      addPlaylistItem: new AddPlaylistItemUseCase({
        playlistRepository: routerDeps.repositories.playlistRepository,
        contentRepository: routerDeps.repositories.contentRepository,
        scheduleRepository: routerDeps.repositories.scheduleRepository,
        displayEventPublisher: routerDeps.displayEventPublisher,
      }),
      updatePlaylistItem: new UpdatePlaylistItemUseCase({
        playlistRepository: routerDeps.repositories.playlistRepository,
        contentRepository: routerDeps.repositories.contentRepository,
        scheduleRepository: routerDeps.repositories.scheduleRepository,
        displayEventPublisher: routerDeps.displayEventPublisher,
      }),
      replacePlaylistItemsAtomic: new ReplacePlaylistItemsAtomicUseCase({
        playlistRepository: routerDeps.repositories.playlistRepository,
        contentRepository: routerDeps.repositories.contentRepository,
        scheduleRepository: routerDeps.repositories.scheduleRepository,
        displayEventPublisher: routerDeps.displayEventPublisher,
      }),
      reorderPlaylistItems: new ReorderPlaylistItemsUseCase({
        playlistRepository: routerDeps.repositories.playlistRepository,
        contentRepository: routerDeps.repositories.contentRepository,
        scheduleRepository: routerDeps.repositories.scheduleRepository,
        displayEventPublisher: routerDeps.displayEventPublisher,
      }),
      deletePlaylistItem: new DeletePlaylistItemUseCase({
        playlistRepository: routerDeps.repositories.playlistRepository,
        contentRepository: routerDeps.repositories.contentRepository,
        scheduleRepository: routerDeps.repositories.scheduleRepository,
        displayEventPublisher: routerDeps.displayEventPublisher,
      }),
    },
  };
};
