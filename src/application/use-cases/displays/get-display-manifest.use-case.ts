import { ValidationError } from "#/application/errors/validation";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import {
  type DisplayRecord,
  type DisplayRepository,
} from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type RuntimeControlRepository } from "#/application/ports/runtime-controls";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { sha256Hex } from "#/domain/content/checksum";
import {
  selectActiveScheduleByKind,
  selectActiveSchedulesByKind,
} from "#/domain/schedules/schedule";
import { NotFoundError } from "./errors";
import {
  isRenderableEmergencyAsset,
  type ManifestRenderableType,
} from "./shared";

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
  textHtmlContent: string | null;
}

interface ManifestRenderableItem {
  id: string;
  sequence: number;
  duration: number;
  content: ManifestRenderableContent;
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

interface ManifestScheduleWindow {
  id: string;
  kind: "PLAYLIST" | "FLASH";
  startTime: string;
  endTime: string;
  startDate: string | null;
  endDate: string | null;
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

const FLASH_TICKER_HEIGHT_PX = 48;
const FLASH_TICKER_SPEED_PX_PER_SEC = 96;
const EMERGENCY_IMAGE_DURATION_SECONDS = 86_400;
const PRESIGNED_URL_CONCURRENCY = 8;

const pickDisplayEmergencyAssetId = (input: {
  display: DisplayRecord;
  defaultEmergencyContentId?: string;
}): string | null =>
  input.display.emergencyContentId ?? input.defaultEmergencyContentId ?? null;

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
      flashContent.status === "READY" &&
      flashContent.flashMessage
        ? {
            scheduleId: activeFlashSchedule.id,
            contentId: flashContent.id,
            message: flashContent.flashMessage,
            tone: flashContent.flashTone ?? "INFO",
            region: "TOP_TICKER" as const,
            heightPx: FLASH_TICKER_HEIGHT_PX,
            speedPxPerSecond: FLASH_TICKER_SPEED_PX_PER_SEC,
          }
        : null;

    const manifestSchedules: ManifestScheduleWindow[] = schedules.map((s) => ({
      id: s.id,
      kind: s.kind ?? "PLAYLIST",
      startTime: s.startTime,
      endTime: s.endTime,
      startDate: s.startDate ?? null,
      endDate: s.endDate ?? null,
    }));

    const emergency = await this.resolveEmergencyPlayback({
      display,
      now: input.now,
      globalEmergencyActive: runtimeOverrides.global.globalEmergencyActive,
      globalEmergencyStartedAt:
        runtimeOverrides.global.globalEmergencyStartedAt,
    });
    if (emergency) {
      const emergencyDuration =
        emergency.content.type === "VIDEO"
          ? Math.max(1, emergency.content.duration ?? 1)
          : EMERGENCY_IMAGE_DURATION_SECONDS;
      const items: ManifestRenderableItem[] = [
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
          playback,
          items,
          schedules: manifestSchedules,
        }),
        generatedAt: input.now.toISOString(),
        playback,
        items,
        schedules: manifestSchedules,
      };
    }

    const activeSchedules = selectActiveSchedulesByKind(
      schedules,
      "PLAYLIST",
      input.now,
      this.deps.scheduleTimeZone ?? "UTC",
    );

    const playback: ManifestPlaybackState = {
      mode: "SCHEDULE",
      emergency: null,
      flash,
    };

    if (activeSchedules.length === 0) {
      return {
        playlistId: null,
        playlistVersion: await this.computePlaylistVersion({
          playlistId: null,
          refreshNonce: display.refreshNonce ?? 0,
          playback,
          items: [],
          schedules: manifestSchedules,
        }),
        generatedAt: input.now.toISOString(),
        playback,
        items: [],
        schedules: manifestSchedules,
      };
    }

    const playlistIds = activeSchedules
      .map((s) => s.playlistId)
      .filter((id): id is string => id !== null);

    if (playlistIds.length === 0) {
      throw new ValidationError("Playlist schedule is missing playlistId");
    }

    const playlists = await this.deps.playlistRepository.findByIds(playlistIds);
    if (playlists.length === 0) throw new NotFoundError("Playlist not found");

    const playlist = playlists[0];
    if (!playlist) throw new NotFoundError("Playlist not found");

    const allPlaylistItems = this.deps.playlistRepository.listItemsByPlaylistIds
      ? await this.deps.playlistRepository.listItemsByPlaylistIds(playlistIds)
      : await Promise.all(
          playlistIds.map((id) => this.deps.playlistRepository.listItems(id)),
        ).then((results) => results.flat());

    const items = allPlaylistItems.sort((a, b) => a.sequence - b.sequence);
    const contentIds = Array.from(new Set(items.map((item) => item.contentId)));
    const contents = await this.deps.contentRepository.findByIds(contentIds);
    const contentsById = new Map(
      contents.map((content) => [content.id, content]),
    );

    const manifestItems: ManifestRenderableItem[] = await mapWithConcurrency(
      items,
      PRESIGNED_URL_CONCURRENCY,
      async (item, index) => {
        const content = contentsById.get(item.contentId);
        if (!content) {
          throw new NotFoundError("Content not found");
        }

        if (
          content.type !== "IMAGE" &&
          content.type !== "VIDEO" &&
          content.type !== "TEXT"
        ) {
          throw new ValidationError(
            `Unsupported content type in playlist: ${content.type}`,
          );
        }
        const downloadUrl =
          content.type === "TEXT"
            ? ""
            : await this.deps.contentStorage.getPresignedDownloadUrl({
                key: content.fileKey,
                expiresInSeconds: this.deps.downloadUrlExpiresInSeconds,
              });
        const thumbnailUrl = content.thumbnailKey
          ? await this.deps.contentStorage.getPresignedDownloadUrl({
              key: content.thumbnailKey,
              expiresInSeconds: this.deps.downloadUrlExpiresInSeconds,
            })
          : null;

        return {
          id: item.id,
          sequence: index + 1,
          duration: item.duration,
          content: {
            id: content.id,
            type: content.type,
            checksum: content.checksum,
            downloadUrl,
            thumbnailUrl,
            mimeType: content.mimeType,
            width: content.width,
            height: content.height,
            duration: content.duration,
            textHtmlContent: content.textHtmlContent ?? null,
          },
        };
      },
    );

    return {
      playlistId: playlist.id,
      playlistVersion: await this.computePlaylistVersion({
        playlistId: playlist.id,
        refreshNonce: display.refreshNonce ?? 0,
        playback,
        items: manifestItems,
        schedules: manifestSchedules,
      }),
      generatedAt: input.now.toISOString(),
      playback,
      items: manifestItems,
      schedules: manifestSchedules,
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

    const downloadUrl =
      emergencyAsset.type === "TEXT"
        ? ""
        : await this.deps.contentStorage.getPresignedDownloadUrl({
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
        textHtmlContent: emergencyAsset.textHtmlContent ?? null,
      },
    };
  }

  private async computePlaylistVersion(input: {
    playlistId: string | null;
    refreshNonce: number;
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
    schedules: ManifestScheduleWindow[];
  }): Promise<string> {
    const versionPayload = JSON.stringify({
      playlistId: input.playlistId,
      refreshNonce: input.refreshNonce,
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
      })),
      schedules: input.schedules.map((s) => ({
        id: s.id,
        kind: s.kind,
        startTime: s.startTime,
        endTime: s.endTime,
        startDate: s.startDate,
        endDate: s.endDate,
      })),
    });
    return sha256Hex(new TextEncoder().encode(versionPayload).buffer);
  }
}
