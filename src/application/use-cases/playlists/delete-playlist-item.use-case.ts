import { ValidationError } from "#/application/errors/validation";
import { type ContentRepository } from "#/application/ports/content";
import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { NotFoundError } from "./errors";
import {
  findPlaylistByIdForOwner,
  runPlaylistPostMutationEffects,
} from "./shared";

export class DeletePlaylistItemUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      scheduleRepository?: ScheduleRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
    },
  ) {}

  async execute(input: { playlistId: string; ownerId?: string; id: string }) {
    const playlist = await findPlaylistByIdForOwner(
      this.deps.playlistRepository,
      input.playlistId,
      input.ownerId,
    );
    if (!playlist) throw new NotFoundError("Playlist not found");

    const items = await this.deps.playlistRepository.listItems(
      input.playlistId,
    );
    const existing = items.find((item) => item.id === input.id);
    if (!existing) throw new NotFoundError("Playlist item not found");
    if (items.length <= 1) {
      throw new ValidationError("Playlists must contain at least one item.");
    }

    const deleted = await this.deps.playlistRepository.deleteItem(input.id);
    if (!deleted) throw new NotFoundError("Playlist item not found");

    await runPlaylistPostMutationEffects(
      this.deps,
      existing.playlistId,
      "playlist_item_deleted",
    );
  }
}
