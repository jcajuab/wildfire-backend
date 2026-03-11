import { type PlaylistRepository } from "#/application/ports/playlists";
import { type PlaylistStatus } from "#/domain/playlists/playlist";
import { listPlaylistsForOwner } from "./shared";

export class ListPlaylistOptionsUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
    },
  ) {}

  async execute(input?: {
    ownerId?: string;
    q?: string;
    status?: PlaylistStatus;
  }) {
    const normalizedQuery = input?.q?.trim().toLowerCase();
    const playlists = input?.ownerId
      ? await listPlaylistsForOwner(this.deps.playlistRepository, input.ownerId)
      : await this.deps.playlistRepository.list();

    return playlists
      .filter((playlist) => {
        if (input?.status && playlist.status !== input.status) {
          return false;
        }

        if (!normalizedQuery) {
          return true;
        }

        return (
          playlist.name.toLowerCase().includes(normalizedQuery) ||
          (playlist.description?.toLowerCase().includes(normalizedQuery) ??
            false)
        );
      })
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
      }));
  }
}
