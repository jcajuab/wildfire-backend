import { ValidationError } from "#/application/errors/validation";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { type DisplayKeyRepository } from "#/application/ports/display-auth";
import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import {
  type DisplayGroupRepository,
  type DisplayRecord,
  type DisplayRepository,
  type DisplayStatus,
} from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type RuntimeControlRepository } from "#/application/ports/runtime-controls";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { paginate } from "#/application/use-cases/shared/pagination";
import { splitPdfDocumentDurationAcrossPages } from "#/application/use-cases/shared/pdf-duration";
import { sha256Hex } from "#/domain/content/checksum";
import { selectActiveScheduleByKind } from "#/domain/schedules/schedule";
import { NotFoundError } from "./errors";

const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) return [];

  const workerCount = Math.max(
    1,
    Math.min(Math.trunc(concurrency), items.length),
  );
  const result = new Array<R>(items.length);
  let index = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = index;
        index += 1;
        if (currentIndex >= items.length) {
          return;
        }

        const item = items[currentIndex];
        if (!item) {
          continue;
        }
        result[currentIndex] = await mapper(item, currentIndex);
      }
    }),
  );

  return result;
};

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
export const DISPLAY_DOWN_TIMEOUT_MS = ONLINE_WINDOW_MS;
const DEFAULT_RUNTIME_SCROLL_PX_PER_SECOND = 24;

type ManifestRenderableType = "IMAGE" | "VIDEO" | "PDF";

interface ManifestRenderableContent {
  id: string;
  type: ManifestRenderableType;
  checksum: string;
  downloadUrl: string;
  thumbnailUrl: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  scrollPxPerSecond: number | null;
}

interface ManifestFlashState {
  scheduleId: string;
  contentId: string;
  message: string;
  tone: "INFO" | "WARNING" | "CRITICAL";
  region: "TOP_TICKER";
  heightPx: number;
  speedPxPerSecond: number;
}

interface ManifestPlaybackState {
  mode: "SCHEDULE" | "EMERGENCY";
  emergency: {
    source: "DISPLAY" | "DEFAULT";
    startedAt: string | null;
    isGlobal: boolean;
    content: ManifestRenderableContent;
  } | null;
  flash: ManifestFlashState | null;
}

const isRecentlySeen = (lastSeenAt: string | null, now: Date): boolean => {
  const lastSeenMs = lastSeenAt ? Date.parse(lastSeenAt) : Number.NaN;
  return (
    Number.isFinite(lastSeenMs) &&
    now.getTime() - lastSeenMs <= ONLINE_WINDOW_MS
  );
};

export const deriveDisplayStatus = (input: {
  lastSeenAt: string | null;
  hasActivePlayback: boolean;
  now: Date;
}): DisplayStatus => {
  if (!isRecentlySeen(input.lastSeenAt, input.now)) {
    return input.lastSeenAt ? "DOWN" : "PROCESSING";
  }
  return input.hasActivePlayback ? "LIVE" : "READY";
};

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

const pickDisplayEmergencyAssetId = (input: {
  display: DisplayRecord;
  defaultEmergencyContentId?: string;
}): string | null =>
  input.display.emergencyContentId ?? input.defaultEmergencyContentId ?? null;

export class ActivateGlobalEmergencyUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      contentRepository: ContentRepository;
      runtimeControlRepository: RuntimeControlRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
      defaultEmergencyContentId?: string;
    },
  ) {}

  async execute(input: { reason?: string }): Promise<void> {
    const now = new Date();
    const displays = await this.deps.displayRepository.list();
    if (displays.length === 0) {
      await this.deps.runtimeControlRepository.setGlobalEmergencyState({
        active: true,
        startedAt: now,
        at: now,
      });
      return;
    }

    const assetIds = Array.from(
      new Set(
        displays
          .map((display) =>
            pickDisplayEmergencyAssetId({
              display,
              defaultEmergencyContentId: this.deps.defaultEmergencyContentId,
            }),
          )
          .filter((value): value is string => value != null),
      ),
    );

    const assets = await this.deps.contentRepository.findByIds(assetIds);
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

    const missingDisplay = displays.find((display) => {
      const selectedAssetId = pickDisplayEmergencyAssetId({
        display,
        defaultEmergencyContentId: this.deps.defaultEmergencyContentId,
      });
      if (!selectedAssetId) {
        return true;
      }
      const asset = assetsById.get(selectedAssetId);
      return !asset || !isRenderableEmergencyAsset(asset);
    });

    if (missingDisplay) {
      throw new ValidationError(
        `Display ${missingDisplay.slug} has no valid emergency content asset`,
      );
    }

    await this.deps.runtimeControlRepository.setGlobalEmergencyState({
      active: true,
      startedAt: now,
      at: now,
    });

    for (const display of displays) {
      this.deps.displayEventPublisher?.publish({
        type: "manifest_updated",
        displayId: display.id,
        reason: input.reason ?? "global_emergency_activated",
        timestamp: now.toISOString(),
      });
    }
  }
}

export class DeactivateGlobalEmergencyUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      runtimeControlRepository: RuntimeControlRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
    },
  ) {}

  async execute(input: { reason?: string }): Promise<void> {
    const now = new Date();
    await this.deps.runtimeControlRepository.setGlobalEmergencyState({
      active: false,
      startedAt: null,
      at: now,
    });
    const displays = await this.deps.displayRepository.list();
    for (const display of displays) {
      this.deps.displayEventPublisher?.publish({
        type: "manifest_updated",
        displayId: display.id,
        reason: input.reason ?? "global_emergency_deactivated",
        timestamp: now.toISOString(),
      });
    }
  }
}

export class GetRuntimeOverridesUseCase {
  constructor(
    private readonly deps: {
      runtimeControlRepository: RuntimeControlRepository;
    },
  ) {}

  async execute(_input: { now: Date }) {
    const global = await this.deps.runtimeControlRepository.getGlobal();

    return {
      globalEmergency: {
        active: global.globalEmergencyActive,
        startedAt: global.globalEmergencyStartedAt,
      },
    };
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

export class GetDisplayActiveScheduleUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      displayRepository: DisplayRepository;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input: { displayId: string; now: Date }) {
    await this.deps.displayRepository.touchSeen(input.displayId, input.now);
    const [display, schedules] = await Promise.all([
      this.deps.displayRepository.findById(input.displayId),
      this.deps.scheduleRepository.listByDisplay(input.displayId),
    ]);
    if (!display) throw new NotFoundError("Display not found");
    const active = selectActiveScheduleByKind(
      schedules,
      "PLAYLIST",
      input.now,
      this.deps.scheduleTimeZone ?? "UTC",
    );

    if (!active) return null;

    return {
      id: active.id,
      name: active.name,
      playlistId: active.playlistId,
      displayId: active.displayId,
      startDate: active.startDate,
      endDate: active.endDate,
      startTime: active.startTime,
      endTime: active.endTime,
      isActive: active.isActive,
      createdAt: active.createdAt,
      updatedAt: active.updatedAt,
      playlist: {
        id: active.playlistId ?? "",
        name:
          (await this.deps.playlistRepository.findById(active.playlistId ?? ""))
            ?.name ?? null,
      },
      display: { id: display.id, name: display.name },
    };
  }
}

export class GetDisplayManifestUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      contentStorage: ContentStorage;
      displayRepository: DisplayRepository;
      runtimeControlRepository?: RuntimeControlRepository;
      downloadUrlExpiresInSeconds: number;
      scheduleTimeZone?: string;
      defaultEmergencyContentId?: string;
    },
  ) {}

  async execute(input: { displayId: string; now: Date }) {
    await this.deps.displayRepository.touchSeen(input.displayId, input.now);
    const [display, schedules, runtimeOverrides] = await Promise.all([
      this.deps.displayRepository.findById(input.displayId),
      this.deps.scheduleRepository.listByDisplay(input.displayId),
      this.getRuntimeOverrides(input.now),
    ]);
    if (!display) throw new NotFoundError("Display not found");
    const activeFlashSchedule = selectActiveScheduleByKind(
      schedules,
      "FLASH",
      input.now,
      this.deps.scheduleTimeZone ?? "UTC",
    );
    const flashContent =
      activeFlashSchedule?.contentId != null
        ? await this.deps.contentRepository.findById(
            activeFlashSchedule.contentId,
          )
        : null;
    const flash =
      activeFlashSchedule &&
      flashContent &&
      flashContent.type === "FLASH" &&
      flashContent.kind === "ROOT" &&
      flashContent.status === "READY" &&
      flashContent.flashMessage
        ? {
            scheduleId: activeFlashSchedule.id,
            contentId: flashContent.id,
            message: flashContent.flashMessage,
            tone: flashContent.flashTone ?? "INFO",
            region: "TOP_TICKER" as const,
            heightPx: 48,
            speedPxPerSecond: 96,
          }
        : null;

    const emergency = await this.resolveEmergencyPlayback({
      display,
      now: input.now,
      globalEmergencyActive: runtimeOverrides.global.globalEmergencyActive,
      globalEmergencyStartedAt:
        runtimeOverrides.global.globalEmergencyStartedAt,
    });
    if (emergency) {
      const runtimeSettings = await this.getRuntimeSettings();
      const emergencyDuration =
        emergency.content.type === "VIDEO"
          ? Math.max(1, emergency.content.duration ?? 1)
          : 86_400;
      const items = [
        {
          id: `emergency:${emergency.content.id}`,
          sequence: 1,
          duration: emergencyDuration,
          content: emergency.content,
        },
      ];
      const playback: ManifestPlaybackState = {
        mode: "EMERGENCY",
        emergency,
        flash: null,
      };

      return {
        playlistId: null,
        playlistVersion: await this.computePlaylistVersion({
          playlistId: null,
          refreshNonce: display.refreshNonce ?? 0,
          runtimeSettings,
          playback,
          items,
        }),
        generatedAt: input.now.toISOString(),
        runtimeSettings,
        playback,
        items,
      };
    }

    const active = selectActiveScheduleByKind(
      schedules,
      "PLAYLIST",
      input.now,
      this.deps.scheduleTimeZone ?? "UTC",
    );

    const runtimeSettings = await this.getRuntimeSettings();
    const playback: ManifestPlaybackState = {
      mode: "SCHEDULE",
      emergency: null,
      flash,
    };

    if (!active) {
      return {
        playlistId: null,
        playlistVersion: await this.computePlaylistVersion({
          playlistId: null,
          refreshNonce: display.refreshNonce ?? 0,
          runtimeSettings,
          playback,
          items: [],
        }),
        generatedAt: input.now.toISOString(),
        runtimeSettings,
        playback,
        items: [],
      };
    }

    const playlistId = active.playlistId;
    if (!playlistId) {
      throw new ValidationError("Playlist schedule is missing playlistId");
    }
    const playlist = await this.deps.playlistRepository.findById(playlistId);
    if (!playlist) throw new NotFoundError("Playlist not found");

    const items = await this.deps.playlistRepository.listItems(playlist.id);
    const contentIds = Array.from(new Set(items.map((item) => item.contentId)));
    const contents = await this.deps.contentRepository.findByIds(contentIds);
    const contentsById = new Map(
      contents.map((content) => [content.id, content]),
    );
    const missingParentIds = Array.from(
      new Set(
        contents
          .filter(
            (content) => content.kind === "PAGE" && content.parentContentId,
          )
          .map((content) => content.parentContentId as string),
      ),
    ).filter((id) => !contentsById.has(id));
    if (missingParentIds.length > 0) {
      const parentContents =
        await this.deps.contentRepository.findByIds(missingParentIds);
      for (const parentContent of parentContents) {
        contentsById.set(parentContent.id, parentContent);
      }
    }
    const parentPdfContentIds = contents
      .filter((content) => content.kind === "ROOT" && content.type === "PDF")
      .map((content) => content.id);
    const childPagesByParentId = new Map<string, typeof contents>();
    if (
      parentPdfContentIds.length > 0 &&
      this.deps.contentRepository.findChildrenByParentIds
    ) {
      const childPages =
        await this.deps.contentRepository.findChildrenByParentIds(
          parentPdfContentIds,
          {
            includeExcluded: false,
            onlyReady: true,
          },
        );
      for (const childPage of childPages) {
        if (!childPage.parentContentId) {
          continue;
        }
        const current =
          childPagesByParentId.get(childPage.parentContentId) ?? [];
        childPagesByParentId.set(childPage.parentContentId, [
          ...current,
          childPage,
        ]);
      }
      for (const [parentId, pages] of childPagesByParentId) {
        childPagesByParentId.set(
          parentId,
          [...pages].sort(
            (left, right) => (left.pageNumber ?? 0) - (right.pageNumber ?? 0),
          ),
        );
      }
    }

    const expandedItems: Array<{
      id: string;
      sequence: number;
      duration: number;
      content: (typeof contents)[number];
    }> = [];
    let expandedSequence = 1;
    const sortedPlaylistItems = [...items].sort(
      (left, right) => left.sequence - right.sequence,
    );
    for (const item of sortedPlaylistItems) {
      const content = contentsById.get(item.contentId);
      if (!content) {
        throw new NotFoundError("Content not found");
      }

      if (content.kind === "ROOT" && content.type === "PDF") {
        const childPages = childPagesByParentId.get(content.id) ?? [];
        const pages = childPages.length > 0 ? childPages : [content];
        const pageDurations = splitPdfDocumentDurationAcrossPages({
          totalDurationSeconds: item.duration,
          pageCount: pages.length,
        });
        for (const [index, page] of pages.entries()) {
          expandedItems.push({
            id: `${item.id}:${page.id}`,
            sequence: expandedSequence,
            duration: pageDurations[index] ?? 1,
            content: page,
          });
          expandedSequence += 1;
        }
        continue;
      }

      expandedItems.push({
        id: item.id,
        sequence: expandedSequence,
        duration: item.duration,
        content,
      });
      expandedSequence += 1;
    }

    const manifestItems = await mapWithConcurrency(
      expandedItems,
      8,
      async (item) => {
        if (
          item.content.type !== "IMAGE" &&
          item.content.type !== "VIDEO" &&
          item.content.type !== "PDF"
        ) {
          throw new ValidationError(
            `Unsupported content type in playlist: ${item.content.type}`,
          );
        }
        const downloadUrl =
          await this.deps.contentStorage.getPresignedDownloadUrl({
            key: item.content.fileKey,
            expiresInSeconds: this.deps.downloadUrlExpiresInSeconds,
          });
        const parentContent =
          item.content.kind === "PAGE" && item.content.parentContentId
            ? contentsById.get(item.content.parentContentId)
            : null;
        const thumbnailKey =
          item.content.thumbnailKey ?? parentContent?.thumbnailKey ?? null;
        const thumbnailUrl = thumbnailKey
          ? await this.deps.contentStorage.getPresignedDownloadUrl({
              key: thumbnailKey,
              expiresInSeconds: this.deps.downloadUrlExpiresInSeconds,
            })
          : null;

        return {
          id: item.id,
          sequence: item.sequence,
          duration: item.duration,
          content: {
            id: item.content.id,
            type: item.content.type,
            checksum: item.content.checksum,
            downloadUrl,
            thumbnailUrl,
            mimeType: item.content.mimeType,
            width: item.content.width,
            height: item.content.height,
            duration: item.content.duration,
            scrollPxPerSecond:
              item.content.scrollPxPerSecond ??
              (item.content.kind === "PAGE" && item.content.parentContentId
                ? (contentsById.get(item.content.parentContentId)
                    ?.scrollPxPerSecond ?? null)
                : null),
          },
        };
      },
    );

    return {
      playlistId: playlist.id,
      playlistVersion: await this.computePlaylistVersion({
        playlistId: playlist.id,
        refreshNonce: display.refreshNonce ?? 0,
        runtimeSettings,
        playback,
        items: manifestItems,
      }),
      generatedAt: input.now.toISOString(),
      runtimeSettings,
      playback,
      items: manifestItems,
    };
  }

  private async getRuntimeOverrides(now: Date): Promise<{
    global: {
      globalEmergencyActive: boolean;
      globalEmergencyStartedAt: string | null;
    };
  }> {
    const global = await (this.deps.runtimeControlRepository
      ? this.deps.runtimeControlRepository.getGlobal()
      : Promise.resolve({
          id: "global" as const,
          globalEmergencyActive: false,
          globalEmergencyStartedAt: null,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        }));

    return {
      global: {
        globalEmergencyActive: global.globalEmergencyActive,
        globalEmergencyStartedAt: global.globalEmergencyStartedAt,
      },
    };
  }

  private async resolveEmergencyPlayback(input: {
    display: DisplayRecord;
    now: Date;
    globalEmergencyActive: boolean;
    globalEmergencyStartedAt: string | null;
  }): Promise<ManifestPlaybackState["emergency"]> {
    if (!input.globalEmergencyActive) {
      return null;
    }

    const emergencyContentId = pickDisplayEmergencyAssetId({
      display: input.display,
      defaultEmergencyContentId: this.deps.defaultEmergencyContentId,
    });
    if (!emergencyContentId) {
      return null;
    }
    const emergencyAsset =
      await this.deps.contentRepository.findById(emergencyContentId);
    if (!emergencyAsset || !isRenderableEmergencyAsset(emergencyAsset)) {
      return null;
    }

    const downloadUrl = await this.deps.contentStorage.getPresignedDownloadUrl({
      key: emergencyAsset.fileKey,
      expiresInSeconds: this.deps.downloadUrlExpiresInSeconds,
    });
    const thumbnailUrl = emergencyAsset.thumbnailKey
      ? await this.deps.contentStorage.getPresignedDownloadUrl({
          key: emergencyAsset.thumbnailKey,
          expiresInSeconds: this.deps.downloadUrlExpiresInSeconds,
        })
      : null;

    return {
      source: input.display.emergencyContentId ? "DISPLAY" : "DEFAULT",
      startedAt: input.globalEmergencyStartedAt,
      isGlobal: true,
      content: {
        id: emergencyAsset.id,
        type: emergencyAsset.type,
        checksum: emergencyAsset.checksum,
        downloadUrl,
        thumbnailUrl,
        mimeType: emergencyAsset.mimeType,
        width: emergencyAsset.width,
        height: emergencyAsset.height,
        duration: emergencyAsset.duration,
        scrollPxPerSecond: emergencyAsset.scrollPxPerSecond ?? null,
      },
    };
  }

  private async computePlaylistVersion(input: {
    playlistId: string | null;
    refreshNonce: number;
    runtimeSettings: { scrollPxPerSecond: number };
    playback: ManifestPlaybackState;
    items: Array<{
      id: string;
      sequence: number;
      duration: number;
      content: {
        id: string;
        checksum: string;
        scrollPxPerSecond?: number | null;
      };
    }>;
  }): Promise<string> {
    const versionPayload = JSON.stringify({
      playlistId: input.playlistId,
      refreshNonce: input.refreshNonce,
      scrollPxPerSecond: input.runtimeSettings.scrollPxPerSecond,
      playback: {
        mode: input.playback.mode,
        emergency: input.playback.emergency
          ? {
              contentId: input.playback.emergency.content.id,
              isGlobal: input.playback.emergency.isGlobal,
              source: input.playback.emergency.source,
              startedAt: input.playback.emergency.startedAt,
            }
          : null,
        flash: input.playback.flash
          ? {
              scheduleId: input.playback.flash.scheduleId,
              contentId: input.playback.flash.contentId,
              tone: input.playback.flash.tone,
              region: input.playback.flash.region,
              heightPx: input.playback.flash.heightPx,
              speedPxPerSecond: input.playback.flash.speedPxPerSecond,
            }
          : null,
      },
      items: input.items.map((item) => ({
        id: item.id,
        sequence: item.sequence,
        duration: item.duration,
        contentId: item.content.id,
        checksum: item.content.checksum,
        scrollPxPerSecond: item.content.scrollPxPerSecond ?? null,
      })),
    });
    return sha256Hex(new TextEncoder().encode(versionPayload).buffer);
  }

  private async getRuntimeSettings(): Promise<{ scrollPxPerSecond: number }> {
    return {
      scrollPxPerSecond: DEFAULT_RUNTIME_SCROLL_PX_PER_SECOND,
    };
  }
}
