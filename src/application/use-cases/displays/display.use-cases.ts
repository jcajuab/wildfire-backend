import { ValidationError } from "#/application/errors/validation";
import { type ContentRepository } from "#/application/ports/content";
import { type DisplayKeyRepository } from "#/application/ports/display-auth";
import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import {
  type DisplayGroupRepository,
  type DisplayRecord,
  type DisplayRepository,
  type DisplayStatus,
} from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { paginate } from "#/application/use-cases/shared/pagination";
import { selectActiveScheduleByKind } from "#/domain/schedules/schedule";
import { NotFoundError } from "./errors";

type ManifestRenderableType = "IMAGE" | "VIDEO" | "PDF";

function withTelemetry(display: DisplayRecord) {
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

interface DisplayNowPlaying {
  readonly title: string | null;
  readonly playlist: string | null;
  readonly progress: number;
  readonly duration: number;
}

const buildNowPlayingMap = async (input: {
  displays: readonly DisplayRecord[];
  schedules: {
    readonly displayId: string;
    readonly kind?: "PLAYLIST" | "FLASH";
    readonly playlistId: string | null;
    readonly isActive: boolean;
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

const normalizeDisplayQuery = (value: string | undefined): string | null => {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
};

const filterDisplays = (input: {
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

const sortDisplays = (
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

const listDisplaysWithFallback = async (input: {
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

export class ListDisplaysUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      displayGroupRepository: DisplayGroupRepository;
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input?: {
    page?: number;
    pageSize?: number;
    q?: string;
    status?: DisplayStatus;
    output?: string;
    groupIds?: string[];
    sortBy?: "name" | "status" | "location";
    sortDirection?: "asc" | "desc";
  }) {
    const now = new Date();
    const page = input?.page ?? 1;
    const pageSize = input?.pageSize ?? 20;
    const paged = await listDisplaysWithFallback({
      displayRepository: this.deps.displayRepository,
      displayGroupRepository: this.deps.displayGroupRepository,
      page,
      pageSize,
      q: input?.q,
      status: input?.status,
      output: input?.output,
      groupIds: input?.groupIds,
      sortBy: input?.sortBy,
      sortDirection: input?.sortDirection,
    });
    const displayIds = new Set(paged.items.map((display) => display.id));
    const schedulesForPage =
      displayIds.size === 0
        ? []
        : this.deps.scheduleRepository.listByDisplayIds != null
          ? await this.deps.scheduleRepository.listByDisplayIds([...displayIds])
          : (await this.deps.scheduleRepository.list()).filter((schedule) =>
              displayIds.has(schedule.displayId),
            );
    const nowPlayingByDisplayId = await buildNowPlayingMap({
      displays: paged.items,
      schedules: schedulesForPage,
      now,
      timeZone: this.deps.scheduleTimeZone ?? "UTC",
      playlistRepository: this.deps.playlistRepository,
    });
    const withStatus = paged.items.map((display) => ({
      ...withTelemetry(display),
      nowPlaying: nowPlayingByDisplayId.get(display.id) ?? null,
    }));
    return {
      items: withStatus,
      total: paged.total,
      page: paged.page,
      pageSize: paged.pageSize,
    };
  }
}

export class ListDisplayOptionsUseCase {
  constructor(
    private readonly deps: { displayRepository: DisplayRepository },
  ) {}

  async execute(input?: { q?: string; limit?: number }) {
    const normalizedQuery = normalizeDisplayQuery(input?.q);
    const limit = input?.limit;
    const displays = (await this.deps.displayRepository.list())
      .filter((display) =>
        normalizedQuery
          ? [display.name, display.slug, display.location ?? ""].some((value) =>
              value.toLowerCase().includes(normalizedQuery),
            )
          : true,
      )
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((display) => ({
        id: display.id,
        name: display.name,
      }));

    return limit != null ? displays.slice(0, Math.max(1, limit)) : displays;
  }
}

export class ListDisplayOutputOptionsUseCase {
  constructor(
    private readonly deps: { displayRepository: DisplayRepository },
  ) {}

  async execute() {
    return [
      ...new Set(
        (await this.deps.displayRepository.list())
          .map((display) => display.output?.trim() ?? "")
          .filter((value) => value.length > 0),
      ),
    ].sort((left, right) => left.localeCompare(right));
  }
}

export class GetDisplayUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input: { id: string }) {
    const display = await this.deps.displayRepository.findById(input.id);
    if (!display) throw new NotFoundError("Display not found");
    const now = new Date();
    const schedules = await this.deps.scheduleRepository.listByDisplay(
      display.id,
    );
    const active = selectActiveScheduleByKind(
      schedules,
      "PLAYLIST",
      now,
      this.deps.scheduleTimeZone ?? "UTC",
    );
    const playlist = active
      ? await this.deps.playlistRepository.findById(active.playlistId ?? "")
      : null;
    return {
      ...withTelemetry(display),
      nowPlaying: active
        ? {
            title: null,
            playlist: playlist?.name ?? null,
            progress: 0,
            duration: 0,
          }
        : null,
    };
  }
}

const isRenderableEmergencyAsset = (content: {
  type: string;
  kind?: string;
  status: string;
}): content is {
  type: ManifestRenderableType;
  kind: "ROOT" | "PAGE";
  status: "READY";
} =>
  (content.type === "IMAGE" ||
    content.type === "VIDEO" ||
    content.type === "PDF") &&
  content.kind === "ROOT" &&
  content.status === "READY";

export class UpdateDisplayUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      scheduleRepository: ScheduleRepository;
      contentRepository: ContentRepository;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input: {
    id: string;
    ownerId?: string;
    name?: string;
    location?: string | null;
    ipAddress?: string | null;
    macAddress?: string | null;
    screenWidth?: number | null;
    screenHeight?: number | null;
    output?: string | null;
    orientation?: "LANDSCAPE" | "PORTRAIT" | null;
    emergencyContentId?: string | null;
  }) {
    const normalizedName =
      input.name === undefined ? undefined : input.name.trim();
    if (normalizedName !== undefined && normalizedName.length === 0) {
      throw new ValidationError("Name is required");
    }

    const normalizeOptionalText = (
      value: string | null | undefined,
      fieldName: string,
    ): string | null | undefined => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        throw new ValidationError(`${fieldName} cannot be empty`);
      }
      return trimmed;
    };

    const ipAddress = normalizeOptionalText(input.ipAddress, "ipAddress");
    const macAddress = normalizeOptionalText(input.macAddress, "macAddress");
    const normalizedOutputType = normalizeOptionalText(input.output, "output");

    const normalizeDimension = (
      value: number | null | undefined,
      fieldName: string,
    ): number | null | undefined => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      if (!Number.isInteger(value) || value <= 0) {
        throw new ValidationError(`${fieldName} must be a positive integer`);
      }
      return value;
    };

    const screenWidth = normalizeDimension(input.screenWidth, "screenWidth");
    const screenHeight = normalizeDimension(input.screenHeight, "screenHeight");
    if (input.emergencyContentId !== undefined && input.emergencyContentId) {
      const emergencyAsset =
        input.ownerId && this.deps.contentRepository.findByIdForOwner
          ? await this.deps.contentRepository.findByIdForOwner(
              input.emergencyContentId,
              input.ownerId,
            )
          : await this.deps.contentRepository.findById(
              input.emergencyContentId,
            );
      if (!emergencyAsset || !isRenderableEmergencyAsset(emergencyAsset)) {
        throw new ValidationError(
          "emergencyContentId must reference a READY root IMAGE, VIDEO, or PDF asset",
        );
      }
    }

    const updated = await this.deps.displayRepository.update(input.id, {
      name: normalizedName,
      location: input.location,
      ipAddress,
      macAddress,
      screenWidth,
      screenHeight,
      output: normalizedOutputType,
      orientation: input.orientation,
      emergencyContentId: input.emergencyContentId,
    });
    if (!updated) throw new NotFoundError("Display not found");
    return withTelemetry(updated);
  }
}

export class RequestDisplayRefreshUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
    },
  ) {}

  async execute(input: { id: string }): Promise<void> {
    const bumped = await this.deps.displayRepository.bumpRefreshNonce(input.id);
    if (!bumped) {
      throw new NotFoundError("Display not found");
    }
    this.deps.displayEventPublisher?.publish({
      type: "display_refresh_requested",
      displayId: input.id,
      reason: "refresh_nonce_bumped",
    });
  }
}

export class UnregisterDisplayUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      displayKeyRepository: DisplayKeyRepository;
      lifecycleEventPublisher?: {
        publish(input: {
          type: "display_unregistered";
          displayId: string;
          slug: string;
          occurredAt: string;
        }): void;
      };
    },
  ) {}

  async execute(input: { id: string; actorId: string }) {
    const display = await this.deps.displayRepository.findById(input.id);
    if (!display) {
      throw new NotFoundError("Display not found");
    }

    const now = new Date();
    await this.deps.displayKeyRepository.revokeByDisplayId(input.id, now);
    await this.deps.displayRepository.delete(input.id);
    this.deps.lifecycleEventPublisher?.publish({
      type: "display_unregistered",
      displayId: display.id,
      slug: display.slug,
      occurredAt: now.toISOString(),
    });
  }
}
