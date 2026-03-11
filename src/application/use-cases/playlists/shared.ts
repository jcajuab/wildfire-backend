import { type ContentRepository } from "#/application/ports/content";
import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import { type DisplayRepository } from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { DEFAULT_SCROLL_PX_PER_SECOND } from "#/application/use-cases/shared/playlist-effective-duration";
import { computeRequiredMinPlaylistDurationSeconds } from "#/application/use-cases/shared/playlist-required-duration";

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

const parseTimeToSeconds = (value: string): number => {
  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number.parseInt(hourRaw ?? "", 10);
  const minute = Number.parseInt(minuteRaw ?? "", 10);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return 0;
  }
  return hour * 3600 + minute * 60;
};

const scheduleWindowDurationSeconds = (startTime: string, endTime: string) => {
  const startSeconds = parseTimeToSeconds(startTime);
  const endSeconds = parseTimeToSeconds(endTime);
  if (endSeconds > startSeconds) return endSeconds - startSeconds;
  if (endSeconds < startSeconds) return 24 * 3600 - startSeconds + endSeconds;
  return 0;
};

const invalidateImpactedSchedules = async (
  deps: {
    playlistRepository: PlaylistRepository;
    contentRepository: ContentRepository;
    scheduleRepository?: ScheduleRepository;
    displayRepository?: DisplayRepository;
    displayEventPublisher?: DisplayStreamEventPublisher;
  },
  playlistId: string,
): Promise<void> => {
  if (!deps.scheduleRepository || !deps.displayRepository) {
    return;
  }
  const scrollPxPerSecond = DEFAULT_SCROLL_PX_PER_SECOND;
  const schedules = await deps.scheduleRepository.list();
  const impacted = schedules.filter(
    (schedule) => schedule.playlistId === playlistId && schedule.isActive,
  );
  for (const schedule of impacted) {
    const display = await deps.displayRepository.findById(schedule.displayId);
    if (
      !display ||
      typeof display.screenWidth !== "number" ||
      typeof display.screenHeight !== "number"
    ) {
      continue;
    }
    const displayWidth = display.screenWidth;
    const displayHeight = display.screenHeight;
    const required = await computeRequiredMinPlaylistDurationSeconds({
      playlistRepository: deps.playlistRepository,
      contentRepository: deps.contentRepository,
      playlistId,
      displayWidth,
      displayHeight,
      scrollPxPerSecond,
    });
    const windowSeconds = scheduleWindowDurationSeconds(
      schedule.startTime,
      schedule.endTime,
    );
    if (windowSeconds < required) {
      await deps.scheduleRepository.update(schedule.id, { isActive: false });
      deps.displayEventPublisher?.publish({
        type: "schedule_updated",
        displayId: schedule.displayId,
        reason: "schedule_auto_disabled_due_to_playlist_duration",
      });
    }
  }
};

export const runPlaylistPostMutationEffects = async (
  deps: {
    playlistRepository: PlaylistRepository;
    contentRepository: ContentRepository;
    scheduleRepository?: ScheduleRepository;
    displayRepository?: DisplayRepository;
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
