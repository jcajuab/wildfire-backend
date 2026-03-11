import { ValidationError } from "#/application/errors/validation";
import { type ContentRepository } from "#/application/ports/content";
import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import { type DisplayRepository } from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { NotFoundError } from "./errors";
import {
  findPlaylistByIdForOwner,
  runPlaylistPostMutationEffects,
} from "./shared";

export class ReorderPlaylistItemsUseCase {
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
    orderedItemIds: readonly string[];
  }) {
    const playlist = await findPlaylistByIdForOwner(
      this.deps.playlistRepository,
      input.playlistId,
      input.ownerId,
    );
    if (!playlist) {
      throw new NotFoundError("Playlist not found");
    }
    const reordered = await this.deps.playlistRepository.reorderItems({
      playlistId: input.playlistId,
      orderedItemIds: input.orderedItemIds,
    });
    if (!reordered) {
      throw new ValidationError("Invalid playlist reorder payload");
    }

    await runPlaylistPostMutationEffects(
      this.deps,
      input.playlistId,
      "playlist_items_reordered",
    );
  }
}
