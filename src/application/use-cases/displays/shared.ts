import {
  type DisplayGroupRepository,
  type DisplayRecord,
  type DisplayRepository,
  type DisplayStatus,
} from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { paginate } from "#/application/use-cases/shared/pagination";
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
    emergencyContentId: display.emergencyContentId ?? null,
    lastSeenAt,
    status: display.status,
  } as const;
}

export interface DisplayNowPlaying {
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

export const normalizeDisplayQuery = (
  value: string | undefined,
): string | null => {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
};

export const filterDisplays = (input: {
  displays: readonly DisplayRecord[];
  query?: string;
  status?: DisplayStatus;
  output?: string;
  groupIds?: readonly string[];
  groupIdsByDisplayId: Map<string, Set<string>>;
}): DisplayRecord[] => {
  const normalizedQuery = normalizeDisplayQuery(input.query);
  const normalizedOutput = input.output?.trim().toLowerCase();

  return input.displays.filter((display) => {
    if (input.status && display.status !== input.status) {
      return false;
    }

    if (normalizedOutput) {
      const displayOutput = display.output?.trim().toLowerCase() ?? "";
      if (displayOutput !== normalizedOutput) {
        return false;
      }
    }

    if (input.groupIds && input.groupIds.length > 0) {
      const displayGroupIds =
        input.groupIdsByDisplayId.get(display.id) ?? new Set();
      if (!input.groupIds.some((groupId) => displayGroupIds.has(groupId))) {
        return false;
      }
    }

    if (!normalizedQuery) {
      return true;
    }

    return [
      display.name,
      display.slug,
      display.location ?? "",
      display.output ?? "",
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  });
};

export const sortDisplays = (
  displays: readonly DisplayRecord[],
  input?: {
    sortBy?: "name" | "status" | "location";
    sortDirection?: "asc" | "desc";
  },
): DisplayRecord[] => {
  const sortBy = input?.sortBy ?? "name";
  const direction = input?.sortDirection === "desc" ? -1 : 1;

  return [...displays].sort((left, right) => {
    const getLocation = (display: DisplayRecord) => display.location ?? "";

    if (sortBy === "status") {
      const statusDelta = left.status.localeCompare(right.status) * direction;
      if (statusDelta !== 0) {
        return statusDelta;
      }
      return left.name.localeCompare(right.name) * direction;
    }

    if (sortBy === "location") {
      const locationDelta =
        getLocation(left).localeCompare(getLocation(right)) * direction;
      if (locationDelta !== 0) {
        return locationDelta;
      }
      return left.name.localeCompare(right.name) * direction;
    }

    return left.name.localeCompare(right.name) * direction;
  });
};

export const listDisplaysWithFallback = async (input: {
  displayRepository: DisplayRepository;
  displayGroupRepository: DisplayGroupRepository;
  page: number;
  pageSize: number;
  q?: string;
  status?: DisplayStatus;
  output?: string;
  groupIds?: string[];
  sortBy?: "name" | "status" | "location";
  sortDirection?: "asc" | "desc";
}) => {
  if (input.displayRepository.searchPage != null) {
    return input.displayRepository.searchPage({
      page: input.page,
      pageSize: input.pageSize,
      q: input.q,
      status: input.status,
      output: input.output,
      groupIds: input.groupIds,
      sortBy: input.sortBy,
      sortDirection: input.sortDirection,
    });
  }

  const [allDisplays, displayGroups] = await Promise.all([
    input.displayRepository.list(),
    input.displayGroupRepository.list(),
  ]);
  const groupIdsByDisplayId = new Map<string, Set<string>>();
  for (const group of displayGroups) {
    for (const displayId of group.displayIds) {
      const current = groupIdsByDisplayId.get(displayId) ?? new Set<string>();
      current.add(group.id);
      groupIdsByDisplayId.set(displayId, current);
    }
  }

  const filtered = filterDisplays({
    displays: allDisplays,
    query: input.q,
    status: input.status,
    output: input.output,
    groupIds: input.groupIds,
    groupIdsByDisplayId,
  });

  return paginate(sortDisplays(filtered, input), {
    page: input.page,
    pageSize: input.pageSize,
  });
};

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
