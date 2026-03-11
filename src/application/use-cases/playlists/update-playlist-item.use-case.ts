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

export class UpdatePlaylistItemUseCase {
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
    playlistId: string;
    ownerId?: string;
    id: string;
    sequence?: number;
    duration?: number;
  }) {
    if (input.sequence !== undefined && !isValidSequence(input.sequence)) {
      throw new ValidationError("Invalid sequence");
    }
    if (input.duration !== undefined && !isValidDuration(input.duration)) {
      throw new ValidationError("Invalid duration");
    }

    const playlist = await findPlaylistByIdForOwner(
      this.deps.playlistRepository,
      input.playlistId,
      input.ownerId,
    );
    if (!playlist) throw new NotFoundError("Playlist not found");

    const existingItems = await this.deps.playlistRepository.listItems(
      input.playlistId,
    );
    const existingItem = existingItems.find((item) => item.id === input.id);
    if (!existingItem) throw new NotFoundError("Playlist item not found");

    if (input.duration !== undefined) {
      const otherItemsBaseDuration = existingItems
        .filter((item) => item.id !== input.id)
        .reduce((sum, item) => sum + item.duration, 0);
      if (
        otherItemsBaseDuration + input.duration >
        MAX_PLAYLIST_BASE_DURATION_SECONDS
      ) {
        throw new ValidationError(
          `Playlist total duration cannot exceed ${MAX_PLAYLIST_BASE_DURATION_SECONDS} seconds.`,
        );
      }
    }

    const item = await this.deps.playlistRepository.updateItem(input.id, {
      sequence: input.sequence,
      duration: input.duration,
    });
    if (!item) throw new NotFoundError("Playlist item not found");

    const content =
      input.ownerId && this.deps.contentRepository.findByIdForOwner
        ? await this.deps.contentRepository.findByIdForOwner(
            item.contentId,
            input.ownerId,
          )
        : await this.deps.contentRepository.findById(item.contentId);
    if (!content) throw new NotFoundError("Content not found");
    await runPlaylistPostMutationEffects(
      this.deps,
      item.playlistId,
      "playlist_item_updated",
    );

    return toPlaylistItemView(item, content);
  }
}
