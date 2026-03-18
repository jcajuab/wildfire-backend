import { type ContentRepository } from "#/application/ports/content";
import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
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
  const schedules = await deps.scheduleRepository.list();
  const impactedDisplayIds = Array.from(
    new Set(
      schedules
        .filter((schedule) => schedule.playlistId === playlistId)
        .map((schedule) => schedule.displayId),
    ),
  );
  for (const displayId of impactedDisplayIds) {
    deps.displayEventPublisher.publish({
      type: "playlist_updated",
      displayId,
      reason,
    });
  }
};

const invalidateImpactedSchedules = async (
  _deps: {
    playlistRepository: PlaylistRepository;
    contentRepository: ContentRepository;
    scheduleRepository?: ScheduleRepository;
    displayEventPublisher?: DisplayStreamEventPublisher;
  },
  _playlistId: string,
): Promise<void> => {
  // Auto-disable behavior removed: playlists loop naturally on displays,
  // so short playlists no longer cause schedule deactivation.
};

export const runPlaylistPostMutationEffects = async (
  deps: {
    playlistRepository: PlaylistRepository;
    contentRepository: ContentRepository;
    scheduleRepository?: ScheduleRepository;
    displayEventPublisher?: DisplayStreamEventPublisher;
  },
  playlistId: string,
  reason: string,
): Promise<void> => {
  // Item mutations are the primary operation; downstream notifications and
  // schedule invalidation should not fail an already-committed write.
  const results = await Promise.allSettled([
    publishPlaylistUpdateEvents(deps, playlistId, reason),
    invalidateImpactedSchedules(deps, playlistId),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Playlist post-mutation effect failed.", result.reason);
    }
  }
};

export const listPlaylistsForOwner = async (
  playlistRepository: PlaylistRepository,
  ownerId: string,
) => {
  if (playlistRepository.listForOwner) {
    return playlistRepository.listForOwner(ownerId);
  }
  return (await playlistRepository.list()).filter(
    (playlist) => playlist.ownerId === ownerId,
  );
};

export const listPlaylistPageForOwner = async (
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
  if (input.ownerId && playlistRepository.listPageForOwner) {
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

  const { items, total } = await playlistRepository.listPage({
    offset: input.offset,
    limit: input.limit,
    status: input.status,
    search: input.search,
    sortBy: input.sortBy,
    sortDirection: input.sortDirection,
  });

  return {
    items:
      input.ownerId !== undefined
        ? items.filter((playlist) => playlist.ownerId === input.ownerId)
        : items,
    total,
  };
};

export const findPlaylistByIdForOwner = async (
  playlistRepository: PlaylistRepository,
  id: string,
  ownerId?: string,
) => {
  if (ownerId && playlistRepository.findByIdForOwner) {
    return playlistRepository.findByIdForOwner(id, ownerId);
  }

  const playlist = await playlistRepository.findById(id);
  if (ownerId && playlist?.ownerId !== ownerId) {
    return null;
  }
  return playlist;
};

export const updatePlaylistForOwner = async (
  playlistRepository: PlaylistRepository,
  id: string,
  ownerId: string | undefined,
  input: { name?: string; description?: string | null },
) => {
  if (ownerId && playlistRepository.updateForOwner) {
    return playlistRepository.updateForOwner(id, ownerId, input);
  }

  const playlist = await playlistRepository.update(id, input);
  if (ownerId && playlist?.ownerId !== ownerId) {
    return null;
  }
  return playlist;
};

export const deletePlaylistForOwner = async (
  playlistRepository: PlaylistRepository,
  id: string,
  ownerId?: string,
) => {
  if (ownerId && playlistRepository.deleteForOwner) {
    return playlistRepository.deleteForOwner(id, ownerId);
  }

  const playlist = await findPlaylistByIdForOwner(
    playlistRepository,
    id,
    ownerId,
  );
  if (!playlist) {
    return false;
  }
  return playlistRepository.delete(id);
};
