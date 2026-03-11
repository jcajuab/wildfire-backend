import { type PlaylistRepository } from "#/application/ports/playlists";
import { type UserRepository } from "#/application/ports/rbac";
import { NotFoundError } from "./errors";
import { toPlaylistView } from "./playlist-view";

export class CreatePlaylistUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input: {
    name: string;
    description?: string | null;
    ownerId: string;
  }) {
    const owner = await this.deps.userRepository.findById(input.ownerId);
    if (!owner) {
      throw new NotFoundError("User not found");
    }

    const playlist = await this.deps.playlistRepository.create({
      name: input.name,
      description: input.description ?? null,
      ownerId: input.ownerId,
    });
    return toPlaylistView(playlist, owner.name, {
      itemsCount: 0,
      totalDuration: 0,
    });
  }
}
