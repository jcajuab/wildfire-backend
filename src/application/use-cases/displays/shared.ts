import {
  type DisplayRecord,
  type DisplayRepository,
  type DisplayStatus,
} from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { selectActiveScheduleByKind } from "#/domain/schedules/schedule";

export type ManifestRenderableType = "IMAGE" | "VIDEO" | "TEXT";

export function withTelemetry(display: DisplayRecord) {
  const lastSeenAt = display.lastSeenAt ?? null;
  return {
    ...display,
    ipAddress: display.ipAddress ?? null,
    macAddress: display.macAddress ?? null,
    screenWidth: display.screenWidth ?? null,
    screenHeight: display.screenHeight ?? null,
    output: display.output ?? null,
    orientation: display.orientation ?? null,
    lastSeenAt,
    status: display.status,
  } as const;
}

interface DisplayNowPlaying {
  readonly title: string | null;
  readonly playlist: string | null;
  readonly progress: number;
  readonly duration: number;
}

export const buildNowPlayingMap = async (input: {
  displays: readonly DisplayRecord[];
  schedules: {
    readonly displayId: string;
    readonly kind?: "PLAYLIST" | "FLASH";
    readonly playlistId: string | null;
    readonly startDate?: string;
    readonly endDate?: string;
    readonly startTime: string;
    readonly endTime: string;
  }[];
  now: Date;
  timeZone: string;
  playlistRepository: Pick<PlaylistRepository, "findByIds">;
}): Promise<Map<string, DisplayNowPlaying>> => {
  const schedulesByDisplayId = new Map<string, typeof input.schedules>();
  for (const schedule of input.schedules) {
    const existing = schedulesByDisplayId.get(schedule.displayId) ?? [];
    schedulesByDisplayId.set(schedule.displayId, [...existing, schedule]);
  }

  const activePlaylistIds = new Set<string>();
  const activeByDisplayId = new Map<string, string>();
  for (const display of input.displays) {
    const displaySchedules = schedulesByDisplayId.get(display.id) ?? [];
    const active = selectActiveScheduleByKind(
      displaySchedules,
      "PLAYLIST",
      input.now,
      input.timeZone,
    );
    if (!active?.playlistId) continue;
    activePlaylistIds.add(active.playlistId);
    activeByDisplayId.set(display.id, active.playlistId);
  }

  if (activePlaylistIds.size === 0) {
    return new Map();
  }

  const playlists = await input.playlistRepository.findByIds([
    ...activePlaylistIds,
  ]);
  const playlistNames = new Map(
    playlists.map((playlist) => [playlist.id, playlist.name]),
  );
  const nowPlayingByDisplayId = new Map<string, DisplayNowPlaying>();

  for (const [displayId, playlistId] of activeByDisplayId) {
    nowPlayingByDisplayId.set(displayId, {
      title: null,
      playlist: playlistNames.get(playlistId) ?? null,
      progress: 0,
      duration: 0,
    });
  }

  return nowPlayingByDisplayId;
};

export const listDisplaysWithFallback = (input: {
  displayRepository: DisplayRepository;
  offset: number;
  limit: number;
  q?: string;
  status?: DisplayStatus;
  output?: string;
  groupIds?: string[];
  sortBy?: "name" | "status" | "location";
  sortDirection?: "asc" | "desc";
}): Promise<{ items: DisplayRecord[]; total: number }> =>
  input.displayRepository.searchPage({
    offset: input.offset,
    limit: input.limit,
    q: input.q,
    status: input.status,
    output: input.output,
    groupIds: input.groupIds,
    sortBy: input.sortBy,
    sortDirection: input.sortDirection,
  });

export const isRenderableEmergencyAsset = (content: {
  type: string;
  status: string;
}): content is {
  type: ManifestRenderableType;
  status: "READY";
} =>
  (content.type === "IMAGE" ||
    content.type === "VIDEO" ||
    content.type === "TEXT") &&
  content.status === "READY";
