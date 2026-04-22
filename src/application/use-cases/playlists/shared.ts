import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";

export const publishPlaylistUpdateEvents = async (
  deps: {
    scheduleRepository?: ScheduleRepository;
    displayEventPublisher?: DisplayStreamEventPublisher;
  },
  playlistId: string,
  reason: string,
) => {
  if (!deps.scheduleRepository || !deps.displayEventPublisher) {
    return;
  }
  const schedules = await deps.scheduleRepository.listByPlaylistId(playlistId);
  const impactedDisplayIds = Array.from(
    new Set(schedules.map((schedule) => schedule.displayId)),
  );
  for (const displayId of impactedDisplayIds) {
    deps.displayEventPublisher.publish({
      type: "playlist_updated",
      displayId,
      reason,
    });
  }
};

export const runPlaylistPostMutationEffects = async (
  deps: {
    playlistRepository: PlaylistRepository;
    scheduleRepository?: ScheduleRepository;
    displayEventPublisher?: DisplayStreamEventPublisher;
  },
  playlistId: string,
  reason: string,
): Promise<void> => {
  try {
    await publishPlaylistUpdateEvents(deps, playlistId, reason);
  } catch (err) {
    logger.error(
      addErrorContext(
        {
          component: "playlists",
          event: "playlist.post_mutation_effects.failed",
        },
        err,
      ),
    );
  }
};

export const listPlaylistsForOwner = (
  playlistRepository: PlaylistRepository,
  ownerId: string,
) => playlistRepository.listForOwner(ownerId);

export const listPlaylistPageForOwner = (
  playlistRepository: PlaylistRepository,
  input: {
    ownerId?: string;
    offset: number;
    limit: number;
    status?: import("#/domain/playlists/playlist").PlaylistStatus;
    search?: string;
    sortBy?: "updatedAt" | "name";
    sortDirection?: "asc" | "desc";
  },
) => {
  if (input.ownerId) {
    return playlistRepository.listPageForOwner({
      ownerId: input.ownerId,
      offset: input.offset,
      limit: input.limit,
      status: input.status,
      search: input.search,
      sortBy: input.sortBy,
      sortDirection: input.sortDirection,
    });
  }
  return playlistRepository.listPage({
    offset: input.offset,
    limit: input.limit,
    status: input.status,
    search: input.search,
    sortBy: input.sortBy,
    sortDirection: input.sortDirection,
  });
};

export const findPlaylistByIdForOwner = (
  playlistRepository: PlaylistRepository,
  id: string,
  ownerId?: string,
) => {
  if (ownerId) {
    return playlistRepository.findByIdForOwner(id, ownerId);
  }
  return playlistRepository.findById(id);
};

export const updatePlaylistForOwner = (
  playlistRepository: PlaylistRepository,
  id: string,
  ownerId: string | undefined,
  input: { name?: string; description?: string | null },
) => {
  if (ownerId) {
    return playlistRepository.updateForOwner(id, ownerId, input);
  }
  return playlistRepository.update(id, input);
};

export const deletePlaylistForOwner = async (
  playlistRepository: PlaylistRepository,
  id: string,
  ownerId?: string,
) => {
  if (ownerId) {
    return playlistRepository.deleteForOwner(id, ownerId);
  }
  return playlistRepository.delete(id);
};
