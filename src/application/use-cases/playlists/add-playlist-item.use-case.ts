import { ValidationError } from "#/application/errors/validation";
import { type ContentRepository } from "#/application/ports/content";
import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import { type DisplayRepository } from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  isValidDuration,
  isValidSequence,
  MAX_PLAYLIST_BASE_DURATION_SECONDS,
} from "#/domain/playlists/playlist";
import { NotFoundError } from "./errors";
import { toPlaylistItemView } from "./playlist-view";
import {
  findPlaylistByIdForOwner,
  runPlaylistPostMutationEffects,
} from "./shared";

export class AddPlaylistItemUseCase {
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
    contentId: string;
    sequence: number;
    duration: number;
  }) {
    if (!isValidSequence(input.sequence)) {
      throw new ValidationError("Invalid sequence");
    }
    if (!isValidDuration(input.duration)) {
      throw new ValidationError("Invalid duration");
    }

    const playlist = await findPlaylistByIdForOwner(
      this.deps.playlistRepository,
      input.playlistId,
      input.ownerId,
    );
    if (!playlist) throw new NotFoundError("Playlist not found");

    const content =
      input.ownerId && this.deps.contentRepository.findByIdForOwner
        ? await this.deps.contentRepository.findByIdForOwner(
            input.contentId,
            input.ownerId,
          )
        : await this.deps.contentRepository.findById(input.contentId);
    if (!content) throw new NotFoundError("Content not found");
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

    const existingItems = await this.deps.playlistRepository.listItems(
      input.playlistId,
    );
    const existingBaseDuration = existingItems.reduce(
      (sum, item) => sum + item.duration,
      0,
    );
    if (
      existingBaseDuration + input.duration >
      MAX_PLAYLIST_BASE_DURATION_SECONDS
    ) {
      throw new ValidationError(
        `Playlist total duration cannot exceed ${MAX_PLAYLIST_BASE_DURATION_SECONDS} seconds.`,
      );
    }

    const existingContentIds = Array.from(
      new Set(existingItems.map((item) => item.contentId)),
    );
    const existingContents =
      existingContentIds.length > 0
        ? input.ownerId && this.deps.contentRepository.findByIdsForOwner
          ? await this.deps.contentRepository.findByIdsForOwner(
              existingContentIds,
              input.ownerId,
            )
          : await this.deps.contentRepository.findByIds(existingContentIds)
        : [];
    const hasParentPdfRefs = existingContents.some(
      (existingContent) =>
        existingContent.type === "PDF" && existingContent.kind === "ROOT",
    );
    const hasChildPdfRefs = existingContents.some(
      (existingContent) =>
        existingContent.type === "PDF" && existingContent.kind === "PAGE",
    );
    const incomingIsParentPdf =
      content.type === "PDF" && content.kind === "ROOT";
    const incomingIsChildPdf =
      content.type === "PDF" && content.kind === "PAGE";
    if (
      (incomingIsParentPdf && hasChildPdfRefs) ||
      (incomingIsChildPdf && hasParentPdfRefs)
    ) {
      throw new ValidationError(
        "Cannot mix PDF documents and PDF pages in the same playlist.",
      );
    }
    if (existingItems.some((item) => item.sequence === input.sequence)) {
      throw new ValidationError("Sequence already exists in playlist");
    }

    const item = await this.deps.playlistRepository.addItem({
      playlistId: input.playlistId,
      contentId: input.contentId,
      sequence: input.sequence,
      duration: input.duration,
    });
    await runPlaylistPostMutationEffects(
      this.deps,
      input.playlistId,
      "playlist_item_added",
    );

    return toPlaylistItemView(item, content);
  }
}
