import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type UserRepository } from "#/application/ports/rbac";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { NotFoundError } from "./errors";
import { toPlaylistView } from "./playlist-view";
import { publishPlaylistUpdateEvents, updatePlaylistForOwner } from "./shared";

export class UpdatePlaylistUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      userRepository: UserRepository;
      scheduleRepository?: ScheduleRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
    },
  ) {}

  async execute(input: {
    id: string;
    ownerId?: string;
    name?: string;
    description?: string | null;
    showCounter?: boolean;
  }) {
    const playlist = await updatePlaylistForOwner(
      this.deps.playlistRepository,
      input.id,
      input.ownerId,
      {
        name: input.name,
        description: input.description,
        showCounter: input.showCounter,
      },
    );
    if (!playlist) throw new NotFoundError("Playlist not found");

    await publishPlaylistUpdateEvents(
      this.deps,
      playlist.id,
      "playlist_metadata_updated",
    );

    const owner = await this.deps.userRepository.findById(playlist.ownerId);
    const items = await this.deps.playlistRepository.listItems(playlist.id);
    return toPlaylistView(playlist, owner, {
      itemsCount: items.length,
      totalDuration: items.reduce((sum, item) => sum + item.duration, 0),
    });
  }
}
