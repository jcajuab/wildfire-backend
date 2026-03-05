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
import { type FlashActivationRepository } from "#/application/ports/flash-activations";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type RuntimeControlRepository } from "#/application/ports/runtime-controls";
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

type ManifestRenderableType = "IMAGE" | "VIDEO" | "PDF";

interface ManifestRenderableContent {
  id: string;
  type: ManifestRenderableType;
  checksum: string;
  downloadUrl: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  duration: number | null;
}

interface ManifestFlashState {
  activationId: string;
  targetDisplayId: string;
  message: string;
  tone: "INFO" | "WARNING" | "CRITICAL";
  startedAt: string;
  endsAt: string;
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
    emergencyContentId: display.emergencyContentId ?? null,
    localEmergencyActive: display.localEmergencyActive ?? false,
    localEmergencyStartedAt: display.localEmergencyStartedAt ?? null,
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
      contentRepository: ContentRepository;
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
    if (input.emergencyContentId !== undefined && input.emergencyContentId) {
      const emergencyAsset = await this.deps.contentRepository.findById(
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
      outputType: normalizedOutputType,
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
        `Display ${missingDisplay.displaySlug} has no valid emergency content asset`,
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

export class ActivateDisplayEmergencyUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      contentRepository: ContentRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
      defaultEmergencyContentId?: string;
    },
  ) {}

  async execute(input: { displayId: string; reason?: string }): Promise<void> {
    const now = new Date();
    const display = await this.deps.displayRepository.findById(input.displayId);
    if (!display) {
      throw new NotFoundError("Display not found");
    }

    const assetId = pickDisplayEmergencyAssetId({
      display,
      defaultEmergencyContentId: this.deps.defaultEmergencyContentId,
    });
    if (!assetId) {
      throw new ValidationError("No emergency asset is configured for display");
    }
    const asset = await this.deps.contentRepository.findById(assetId);
    if (!asset || !isRenderableEmergencyAsset(asset)) {
      throw new ValidationError("Configured emergency asset is invalid");
    }

    await this.deps.displayRepository.update(input.displayId, {
      localEmergencyActive: true,
      localEmergencyStartedAt: now.toISOString(),
    });
    this.deps.displayEventPublisher?.publish({
      type: "manifest_updated",
      displayId: input.displayId,
      reason: input.reason ?? "display_emergency_activated",
      timestamp: now.toISOString(),
    });
  }
}

export class DeactivateDisplayEmergencyUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
    },
  ) {}

  async execute(input: { displayId: string; reason?: string }): Promise<void> {
    const now = new Date();
    const updated = await this.deps.displayRepository.update(input.displayId, {
      localEmergencyActive: false,
      localEmergencyStartedAt: null,
    });
    if (!updated) {
      throw new NotFoundError("Display not found");
    }
    this.deps.displayEventPublisher?.publish({
      type: "manifest_updated",
      displayId: input.displayId,
      reason: input.reason ?? "display_emergency_deactivated",
      timestamp: now.toISOString(),
    });
  }
}

export class GetRuntimeOverridesUseCase {
  constructor(
    private readonly deps: {
      runtimeControlRepository: RuntimeControlRepository;
      flashActivationRepository: FlashActivationRepository;
    },
  ) {}

  async execute(input: { now: Date }) {
    const [global, flash] = await Promise.all([
      this.deps.runtimeControlRepository.getGlobal(),
      this.deps.flashActivationRepository.findActive(input.now),
    ]);

    return {
      globalEmergency: {
        active: global.globalEmergencyActive,
        startedAt: global.globalEmergencyStartedAt,
      },
      flash: flash
        ? {
            active: true,
            activationId: flash.id,
            targetDisplayId: flash.targetDisplayId,
            message: flash.message,
            tone: flash.tone,
            startedAt: flash.startedAt,
            endsAt: flash.endsAt,
          }
        : null,
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
      runtimeControlRepository?: RuntimeControlRepository;
      flashActivationRepository?: FlashActivationRepository;
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

    const flash =
      runtimeOverrides.flash &&
      runtimeOverrides.flash.targetDisplayId === display.id
        ? {
            activationId: runtimeOverrides.flash.id,
            targetDisplayId: runtimeOverrides.flash.targetDisplayId,
            message: runtimeOverrides.flash.message,
            tone: runtimeOverrides.flash.tone,
            startedAt: runtimeOverrides.flash.startedAt,
            endsAt: runtimeOverrides.flash.endsAt,
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
        flash,
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

    const active = selectActiveSchedule(
      schedules,
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
        for (const page of pages) {
          expandedItems.push({
            id: `${item.id}:${page.id}`,
            sequence: expandedSequence,
            duration: item.duration,
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

        return {
          id: item.id,
          sequence: item.sequence,
          duration: item.duration,
          content: {
            id: item.content.id,
            type: item.content.type,
            checksum: item.content.checksum,
            downloadUrl,
            mimeType: item.content.mimeType,
            width: item.content.width,
            height: item.content.height,
            duration: item.content.duration,
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
    flash: {
      id: string;
      targetDisplayId: string;
      message: string;
      tone: "INFO" | "WARNING" | "CRITICAL";
      startedAt: string;
      endsAt: string;
    } | null;
  }> {
    const [global, flash] = await Promise.all([
      this.deps.runtimeControlRepository
        ? this.deps.runtimeControlRepository.getGlobal()
        : Promise.resolve({
            id: "global" as const,
            globalEmergencyActive: false,
            globalEmergencyStartedAt: null,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          }),
      this.deps.flashActivationRepository
        ? this.deps.flashActivationRepository.findActive(now)
        : Promise.resolve(null),
    ]);

    return {
      global: {
        globalEmergencyActive: global.globalEmergencyActive,
        globalEmergencyStartedAt: global.globalEmergencyStartedAt,
      },
      flash: flash
        ? {
            id: flash.id,
            targetDisplayId: flash.targetDisplayId,
            message: flash.message,
            tone: flash.tone,
            startedAt: flash.startedAt,
            endsAt: flash.endsAt,
          }
        : null,
    };
  }

  private async resolveEmergencyPlayback(input: {
    display: DisplayRecord;
    now: Date;
    globalEmergencyActive: boolean;
    globalEmergencyStartedAt: string | null;
  }): Promise<ManifestPlaybackState["emergency"]> {
    const localEmergencyActive = input.display.localEmergencyActive ?? false;
    if (!input.globalEmergencyActive && !localEmergencyActive) {
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

    const startedAt = input.globalEmergencyActive
      ? input.globalEmergencyStartedAt
      : (input.display.localEmergencyStartedAt ?? null);

    return {
      source: input.display.emergencyContentId ? "DISPLAY" : "DEFAULT",
      startedAt,
      isGlobal: input.globalEmergencyActive,
      content: {
        id: emergencyAsset.id,
        type: emergencyAsset.type,
        checksum: emergencyAsset.checksum,
        downloadUrl,
        mimeType: emergencyAsset.mimeType,
        width: emergencyAsset.width,
        height: emergencyAsset.height,
        duration: emergencyAsset.duration,
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
              activationId: input.playback.flash.activationId,
              targetDisplayId: input.playback.flash.targetDisplayId,
              startedAt: input.playback.flash.startedAt,
              endsAt: input.playback.flash.endsAt,
              tone: input.playback.flash.tone,
            }
          : null,
      },
      items: input.items.map((item) => ({
        id: item.id,
        sequence: item.sequence,
        duration: item.duration,
        contentId: item.content.id,
        checksum: item.content.checksum,
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
