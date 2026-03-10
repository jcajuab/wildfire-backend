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
import { splitPdfDocumentDurationAcrossPages } from "#/application/use-cases/shared/pdf-duration";
import { sha256Hex } from "#/domain/content/checksum";
import {
  selectActiveScheduleByKind,
  selectActiveSchedulesByKind,
} from "#/domain/schedules/schedule";
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
      let items = [
        {
          id: `emergency:${emergency.content.id}`,
          sequence: 1,
          duration: emergencyDuration,
          content: emergency.content,
        },
      ];

      if (emergency.content.type === "PDF") {
        const emergencyAsset = await this.deps.contentRepository.findById(
          emergency.content.id,
        );
        if (emergencyAsset?.kind === "ROOT" && emergencyAsset.type === "PDF") {
          const childPages = this.deps.contentRepository.findChildrenByParentIds
            ? await this.deps.contentRepository.findChildrenByParentIds(
                [emergencyAsset.id],
                {
                  includeExcluded: false,
                  onlyReady: true,
                },
              )
            : [];
          const pages =
            childPages.length > 0
              ? [...childPages].sort(
                  (left, right) =>
                    (left.pageNumber ?? 0) - (right.pageNumber ?? 0),
                )
              : [emergencyAsset];
          const pageDurations = splitPdfDocumentDurationAcrossPages({
            totalDurationSeconds: emergencyDuration,
            pageCount: pages.length,
          });

          items = await mapWithConcurrency(pages, 8, async (page, index) => {
            const downloadUrl =
              await this.deps.contentStorage.getPresignedDownloadUrl({
                key: page.fileKey,
                expiresInSeconds: this.deps.downloadUrlExpiresInSeconds,
              });
            const thumbnailKey =
              page.thumbnailKey ?? emergencyAsset.thumbnailKey ?? null;
            const thumbnailUrl = thumbnailKey
              ? await this.deps.contentStorage.getPresignedDownloadUrl({
                  key: thumbnailKey,
                  expiresInSeconds: this.deps.downloadUrlExpiresInSeconds,
                })
              : null;

            return {
              id: `emergency:${emergencyAsset.id}:${page.id}`,
              sequence: index + 1,
              duration: pageDurations[index] ?? 1,
              content: {
                id: page.id,
                type: "PDF",
                checksum: page.checksum,
                downloadUrl,
                thumbnailUrl,
                mimeType: page.mimeType,
                width: page.width,
                height: page.height,
                duration: page.duration,
                scrollPxPerSecond:
                  page.scrollPxPerSecond ??
                  emergencyAsset.scrollPxPerSecond ??
                  null,
              },
            };
          });
        }
      }

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

    const activeSchedules = selectActiveSchedulesByKind(
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

    if (activeSchedules.length === 0) {
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

    const allItems: Array<{
      playlistId: string;
      contentId: string;
      sequence: number;
      duration: number;
      id: string;
    }> = [];

    for (const schedule of activeSchedules) {
      if (!schedule.playlistId) continue;
      const playlistItems = await this.deps.playlistRepository.listItems(
        schedule.playlistId,
      );
      for (const item of playlistItems) {
        allItems.push({
          ...item,
          playlistId: schedule.playlistId,
        });
      }
    }

    const items = allItems.sort((a, b) => a.sequence - b.sequence);
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
