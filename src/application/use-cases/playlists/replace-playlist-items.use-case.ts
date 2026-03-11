import { ValidationError } from "#/application/errors/validation";
import { type ContentRepository } from "#/application/ports/content";
import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import { type DisplayRepository } from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  isValidDuration,
  MAX_PLAYLIST_BASE_DURATION_SECONDS,
} from "#/domain/playlists/playlist";
import { NotFoundError } from "./errors";
import { toPlaylistItemView } from "./playlist-view";
import {
  findPlaylistByIdForOwner,
  runPlaylistPostMutationEffects,
} from "./shared";

export class ReplacePlaylistItemsAtomicUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      scheduleRepository?: ScheduleRepository;
      displayRepository?: DisplayRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
    },
  ) {}

  async execute(input: {
    ownerId?: string;
    playlistId: string;
    items: readonly (
      | {
          kind: "existing";
          itemId: string;
          duration: number;
        }
      | {
          kind: "new";
          contentId: string;
          duration: number;
        }
    )[];
  }) {
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
      if (content.kind === "PAGE" && content.isExcluded) {
        throw new ValidationError(
          "Excluded PDF pages cannot be added to playlists.",
        );
      }
    }

    const hasParentPdfRefs = contents.some(
      (content) => content.type === "PDF" && content.kind === "ROOT",
    );
    const hasChildPdfRefs = contents.some(
      (content) => content.type === "PDF" && content.kind === "PAGE",
    );
    if (hasParentPdfRefs && hasChildPdfRefs) {
      throw new ValidationError(
        "Cannot mix PDF documents and PDF pages in the same playlist.",
      );
    }

    const replaced = await this.deps.playlistRepository.replaceItemsAtomic({
      playlistId: input.playlistId,
      items: input.items,
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

    return replaced.map((item) => {
      const content = replacedContentById.get(item.contentId);
      if (!content) {
        throw new NotFoundError("Content not found");
      }
      return toPlaylistItemView(item, content);
    });
  }
}
