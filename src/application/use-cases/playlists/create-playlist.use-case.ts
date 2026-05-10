import { ValidationError } from "#/application/errors/validation";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type UserRepository } from "#/application/ports/rbac";
import { NotFoundError } from "./errors";
import { toPlaylistView } from "./playlist-view";
import { type ReplacePlaylistItemsAtomicUseCase } from "./replace-playlist-items.use-case";

export class CreatePlaylistUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      userRepository: UserRepository;
      replacePlaylistItemsAtomicUseCase: Pick<
        ReplacePlaylistItemsAtomicUseCase,
        "execute"
      >;
    },
  ) {}

  async execute(input: {
    name: string;
    description?: string | null;
    showCounter?: boolean;
    ownerId: string;
    items: readonly {
      contentId: string;
      duration: number;
      loop?: boolean;
    }[];
  }) {
    if (input.items.length === 0) {
      throw new ValidationError("Playlists must contain at least one item.");
    }

    const owner = await this.deps.userRepository.findById(input.ownerId);
    if (!owner) {
      throw new NotFoundError("User not found");
    }

    let playlist: Awaited<ReturnType<PlaylistRepository["create"]>> | null =
      null;
    try {
      playlist = await this.deps.playlistRepository.create({
        name: input.name,
        description: input.description ?? null,
        showCounter: input.showCounter ?? false,
        ownerId: input.ownerId,
      });

      const items = await this.deps.replacePlaylistItemsAtomicUseCase.execute({
        ownerId: input.ownerId,
        playlistId: playlist.id,
        items: input.items.map((item) => ({
          kind: "new" as const,
          contentId: item.contentId,
          duration: item.duration,
          loop: item.loop,
        })),
      });

      return toPlaylistView(playlist, owner, {
        itemsCount: items.length,
        totalDuration: items.reduce((sum, item) => sum + item.duration, 0),
      });
    } catch (error) {
      if (playlist) {
        try {
          await this.deps.playlistRepository.delete(playlist.id);
        } catch {
          // Preserve the original validation/write error for callers.
        }
      }
      throw error;
    }
  }
}
