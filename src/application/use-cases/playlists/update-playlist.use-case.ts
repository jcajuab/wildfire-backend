import { type PlaylistRepository } from "#/application/ports/playlists";
import { type UserRepository } from "#/application/ports/rbac";
import { NotFoundError } from "./errors";
import { toPlaylistView } from "./playlist-view";
import { updatePlaylistForOwner } from "./shared";

export class UpdatePlaylistUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input: {
    id: string;
    ownerId?: string;
    name?: string;
    description?: string | null;
  }) {
    const playlist = await updatePlaylistForOwner(
      this.deps.playlistRepository,
      input.id,
      input.ownerId,
      {
        name: input.name,
        description: input.description,
      },
    );
    if (!playlist) throw new NotFoundError("Playlist not found");

    const owner = await this.deps.userRepository.findById(playlist.ownerId);
    const items = await this.deps.playlistRepository.listItems(playlist.id);
    return toPlaylistView(playlist, owner?.name ?? null, {
      itemsCount: items.length,
      totalDuration: items.reduce((sum, item) => sum + item.duration, 0),
    });
  }
}
