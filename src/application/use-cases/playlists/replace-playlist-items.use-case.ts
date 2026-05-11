import { ValidationError } from "#/application/errors/validation";
import {
  type ContentRecord,
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import {
  type PlaylistItemAtomicWriteInput,
  type PlaylistRepository,
} from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  isValidDuration,
  MAX_PLAYLIST_BASE_DURATION_SECONDS,
} from "#/domain/playlists/playlist";
import { NotFoundError } from "./errors";
import { toPlaylistItemView } from "./playlist-view";
import {
  assertPlaylistEligibleContent,
  assertPlaylistItemDurationWithinContent,
  findPlaylistByIdForOwner,
  resolvePlaylistItemLoop,
  runPlaylistPostMutationEffects,
} from "./shared";

export class ReplacePlaylistItemsAtomicUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      scheduleRepository?: ScheduleRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
      contentStorage?: ContentStorage;
      thumbnailUrlExpiresInSeconds?: number;
    },
  ) {}

  private async buildThumbnailUrlMap(
    contents: ContentRecord[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!this.deps.contentStorage) return map;

    const keys = Array.from(
      new Set(
        contents
          .map((c) => c.thumbnailKey)
          .filter((k): k is string => k != null),
      ),
    );

    await Promise.all(
      keys.map(async (key) => {
        try {
          const url = await this.deps.contentStorage?.getPresignedDownloadUrl({
            key,
            expiresInSeconds: this.deps.thumbnailUrlExpiresInSeconds ?? 3600,
          });
          if (url) map.set(key, url);
        } catch {
          // best-effort
        }
      }),
    );

    return map;
  }

  async execute(input: {
    ownerId?: string;
    playlistId: string;
    items: readonly PlaylistItemAtomicWriteInput[];
  }) {
    if (input.items.length === 0) {
      throw new ValidationError("Playlists must contain at least one item.");
    }

    if (!this.deps.playlistRepository.replaceItemsAtomic) {
      throw new Error("Atomic playlist item replacement is not supported");
    }

    const playlist = await findPlaylistByIdForOwner(
      this.deps.playlistRepository,
      input.playlistId,
      input.ownerId,
    );
    if (!playlist) {
      throw new NotFoundError("Playlist not found");
    }

    for (const item of input.items) {
      if (!isValidDuration(item.duration)) {
        throw new ValidationError("Invalid duration");
      }
    }

    const proposedBaseDuration = input.items.reduce(
      (sum, item) => sum + item.duration,
      0,
    );
    if (proposedBaseDuration > MAX_PLAYLIST_BASE_DURATION_SECONDS) {
      throw new ValidationError(
        `Playlist total duration cannot exceed ${MAX_PLAYLIST_BASE_DURATION_SECONDS} seconds.`,
      );
    }

    const existingItems = await this.deps.playlistRepository.listItems(
      input.playlistId,
    );
    const existingById = new Map(existingItems.map((item) => [item.id, item]));

    const seenExistingIds = new Set<string>();
    const requestedContentIds: string[] = [];
    for (const item of input.items) {
      if (item.kind === "existing") {
        if (seenExistingIds.has(item.itemId)) {
          throw new ValidationError("Duplicate playlist item id");
        }
        seenExistingIds.add(item.itemId);
        const existing = existingById.get(item.itemId);
        if (!existing) {
          throw new ValidationError("Invalid playlist item payload");
        }
        requestedContentIds.push(existing.contentId);
        continue;
      }
      requestedContentIds.push(item.contentId);
    }

    const uniqueContentIds = Array.from(new Set(requestedContentIds));
    const contents =
      uniqueContentIds.length > 0
        ? input.ownerId && this.deps.contentRepository.findByIdsForOwner
          ? await this.deps.contentRepository.findByIdsForOwner(
              uniqueContentIds,
              input.ownerId,
            )
          : await this.deps.contentRepository.findByIds(uniqueContentIds)
        : [];
    const contentById = new Map(
      contents.map((content) => [content.id, content]),
    );
    for (const contentId of uniqueContentIds) {
      if (!contentById.has(contentId)) {
        throw new NotFoundError("Content not found");
      }
    }
    for (const content of contentById.values()) {
      assertPlaylistEligibleContent(content);
    }

    for (const item of input.items) {
      if (item.kind !== "new") {
        continue;
      }
      const content = contentById.get(item.contentId);
      if (!content) {
        throw new NotFoundError("Content not found");
      }
      if (content.status !== "READY") {
        throw new ValidationError(
          "Only ready content can be added to playlists.",
        );
      }
    }

    for (const item of input.items) {
      const contentId =
        item.kind === "existing"
          ? (existingById.get(item.itemId)?.contentId ?? null)
          : item.contentId;
      if (!contentId) {
        continue;
      }
      const content = contentById.get(contentId);
      if (!content) {
        continue;
      }
      assertPlaylistItemDurationWithinContent(content, item.duration);
      if (item.loop && content.type !== "VIDEO") {
        throw new ValidationError(
          "Loop is only supported for video playlist items.",
        );
      }
    }

    const normalizedItems = input.items.map((item) => {
      const contentId =
        item.kind === "existing"
          ? (existingById.get(item.itemId)?.contentId ?? null)
          : item.contentId;
      const content = contentId ? contentById.get(contentId) : null;
      const loop = content ? resolvePlaylistItemLoop(content) : false;
      return { ...item, loop };
    });

    const replaced = await this.deps.playlistRepository.replaceItemsAtomic({
      playlistId: input.playlistId,
      items: normalizedItems,
    });
    await runPlaylistPostMutationEffects(
      this.deps,
      input.playlistId,
      "playlist_items_replaced",
    );

    const replacedContentIds = Array.from(
      new Set(replaced.map((item) => item.contentId)),
    );
    const replacedContents =
      replacedContentIds.length > 0
        ? input.ownerId && this.deps.contentRepository.findByIdsForOwner
          ? await this.deps.contentRepository.findByIdsForOwner(
              replacedContentIds,
              input.ownerId,
            )
          : await this.deps.contentRepository.findByIds(replacedContentIds)
        : [];
    const replacedContentById = new Map(
      replacedContents.map((content) => [content.id, content]),
    );
    const thumbnailUrlByKey = await this.buildThumbnailUrlMap(replacedContents);

    return replaced.map((item) => {
      const content = replacedContentById.get(item.contentId);
      if (!content) {
        throw new NotFoundError("Content not found");
      }
      return toPlaylistItemView(item, content, {
        thumbnailUrl: content.thumbnailKey
          ? (thumbnailUrlByKey.get(content.thumbnailKey) ?? null)
          : null,
      });
    });
  }
}
