import { ValidationError } from "#/application/errors/validation";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { type DisplayKeyRepository } from "#/application/ports/display-auth";
import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import {
  type DisplayRecord,
  type DisplayRepository,
  type DisplayStatus,
} from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { sha256Hex } from "#/domain/content/checksum";
import { selectActiveSchedule } from "#/domain/schedules/schedule";
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

const isRecentlySeen = (lastSeenAt: string | null, now: Date): boolean => {
  const lastSeenMs = lastSeenAt ? Date.parse(lastSeenAt) : Number.NaN;
  return (
    Number.isFinite(lastSeenMs) &&
    now.getTime() - lastSeenMs <= ONLINE_WINDOW_MS
  );
};

export const deriveDisplayStatus = (input: {
  lastSeenAt: string | null;
  hasActiveSchedule: boolean;
  now: Date;
}): DisplayStatus => {
  if (!isRecentlySeen(input.lastSeenAt, input.now)) {
    return input.lastSeenAt ? "DOWN" : "PROCESSING";
  }
  return input.hasActiveSchedule ? "LIVE" : "READY";
};

function withTelemetry(display: DisplayRecord) {
  const lastSeenAt = display.lastSeenAt ?? null;
  return {
    ...display,
    ipAddress: display.ipAddress ?? null,
    macAddress: display.macAddress ?? null,
    screenWidth: display.screenWidth ?? null,
    screenHeight: display.screenHeight ?? null,
    outputType: display.outputType ?? null,
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

const buildNowPlayingMap = async (input: {
  displays: readonly DisplayRecord[];
  schedules: {
    readonly displayId: string;
    readonly playlistId: string;
    readonly isActive: boolean;
    readonly startDate?: string;
    readonly endDate?: string;
    readonly startTime: string;
    readonly endTime: string;
    readonly priority: number;
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
    const active = selectActiveSchedule(
      displaySchedules,
      input.now,
      input.timeZone,
    );
    if (!active) continue;
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

export class ListDisplaysUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input?: { page?: number; pageSize?: number }) {
    const now = new Date();
    const page = input?.page ?? 1;
    const pageSize = input?.pageSize ?? 20;
    const paged = await this.deps.displayRepository.listPage({
      page,
      pageSize,
    });
    const schedules = await this.deps.scheduleRepository.list();
    const displayIds = new Set(paged.items.map((display) => display.id));
    const schedulesForPage = schedules.filter((schedule) =>
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
    const active = selectActiveSchedule(
      schedules,
      now,
      this.deps.scheduleTimeZone ?? "UTC",
    );
    const playlist = active
      ? await this.deps.playlistRepository.findById(active.playlistId)
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
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input: {
    id: string;
    name?: string;
    location?: string | null;
    ipAddress?: string | null;
    macAddress?: string | null;
    screenWidth?: number | null;
    screenHeight?: number | null;
    outputType?: string | null;
    orientation?: "LANDSCAPE" | "PORTRAIT" | null;
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
    const normalizedOutputType = normalizeOptionalText(
      input.outputType,
      "outputType",
    );

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
    const updated = await this.deps.displayRepository.update(input.id, {
      name: normalizedName,
      location: input.location,
      ipAddress,
      macAddress,
      screenWidth,
      screenHeight,
      outputType: normalizedOutputType,
      orientation: input.orientation,
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
          displaySlug: string;
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
      displaySlug: display.displaySlug,
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
    const active = selectActiveSchedule(
      schedules,
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
      priority: active.priority,
      isActive: active.isActive,
      createdAt: active.createdAt,
      updatedAt: active.updatedAt,
      playlist: {
        id: active.playlistId,
        name:
          (await this.deps.playlistRepository.findById(active.playlistId))
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
      downloadUrlExpiresInSeconds: number;
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
    const active = selectActiveSchedule(
      schedules,
      input.now,
      this.deps.scheduleTimeZone ?? "UTC",
    );

    if (!active) {
      const runtimeSettings = await this.getRuntimeSettings();
      return {
        playlistId: null,
        playlistVersion: "",
        generatedAt: input.now.toISOString(),
        runtimeSettings,
        items: [],
      };
    }

    const playlist = await this.deps.playlistRepository.findById(
      active.playlistId,
    );
    if (!playlist) throw new NotFoundError("Playlist not found");

    const items = await this.deps.playlistRepository.listItems(playlist.id);
    const contentIds = Array.from(new Set(items.map((item) => item.contentId)));
    const contents = await this.deps.contentRepository.findByIds(contentIds);
    const contentsById = new Map(
      contents.map((content) => [content.id, content]),
    );

    const manifestItems = await mapWithConcurrency(items, 8, async (item) => {
      const content = contentsById.get(item.contentId);
      if (!content) throw new NotFoundError("Content not found");

      const downloadUrl =
        await this.deps.contentStorage.getPresignedDownloadUrl({
          key: content.fileKey,
          expiresInSeconds: this.deps.downloadUrlExpiresInSeconds,
        });

      return {
        id: item.id,
        sequence: item.sequence,
        duration: item.duration,
        content: {
          id: content.id,
          type: content.type,
          checksum: content.checksum,
          downloadUrl,
          mimeType: content.mimeType,
          width: content.width,
          height: content.height,
          duration: content.duration,
        },
      };
    });

    const runtimeSettings = await this.getRuntimeSettings();

    const versionPayload = JSON.stringify({
      playlistId: playlist.id,
      refreshNonce: display.refreshNonce ?? 0,
      scrollPxPerSecond: runtimeSettings.scrollPxPerSecond,
      items: manifestItems.map((item) => ({
        id: item.id,
        sequence: item.sequence,
        duration: item.duration,
        contentId: item.content.id,
        checksum: item.content.checksum,
      })),
    });
    const playlistVersion = await sha256Hex(
      new TextEncoder().encode(versionPayload).buffer,
    );

    return {
      playlistId: playlist.id,
      playlistVersion,
      generatedAt: input.now.toISOString(),
      runtimeSettings,
      items: manifestItems,
    };
  }

  private async getRuntimeSettings(): Promise<{ scrollPxPerSecond: number }> {
    return {
      scrollPxPerSecond: DEFAULT_RUNTIME_SCROLL_PX_PER_SECOND,
    };
  }
}
