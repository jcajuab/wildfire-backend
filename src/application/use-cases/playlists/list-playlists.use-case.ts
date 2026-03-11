import { type PlaylistRepository } from "#/application/ports/playlists";
import { type UserRepository } from "#/application/ports/rbac";
import { type PlaylistStatus } from "#/domain/playlists/playlist";
import { toPlaylistView } from "./playlist-view";
import { listPlaylistPageForOwner } from "./shared";

export class ListPlaylistsUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input?: {
    ownerId?: string;
    page?: number;
    pageSize?: number;
    status?: PlaylistStatus;
    search?: string;
    sortBy?: "updatedAt" | "name";
    sortDirection?: "asc" | "desc";
  }) {
    const page = Math.max(Math.trunc(input?.page ?? 1), 1);
    const pageSize = Math.min(
      Math.max(Math.trunc(input?.pageSize ?? 20), 1),
      100,
    );
    const offset = (page - 1) * pageSize;

    const { items: playlists, total } = await listPlaylistPageForOwner(
      this.deps.playlistRepository,
      {
        ownerId: input?.ownerId,
        offset,
        limit: pageSize,
        status: input?.status,
        search: input?.search,
        sortBy: input?.sortBy,
        sortDirection: input?.sortDirection,
      },
    );
    const creatorIds = Array.from(
      new Set(playlists.map((item) => item.ownerId)),
    );
    const creators = await this.deps.userRepository.findByIds(creatorIds);
    const creatorsById = new Map(creators.map((user) => [user.id, user]));

    const playlistIds = playlists.map((playlist) => playlist.id);
    const statsByPlaylistId = this.deps.playlistRepository
      .listItemStatsByPlaylistIds
      ? await this.deps.playlistRepository.listItemStatsByPlaylistIds(
          playlistIds,
        )
      : await this.buildStatsByPlaylistId(playlistIds);

    const items = playlists.map((playlist) =>
      toPlaylistView(
        playlist,
        creatorsById.get(playlist.ownerId)?.name ?? null,
        statsByPlaylistId.get(playlist.id),
      ),
    );

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  private async buildStatsByPlaylistId(playlistIds: string[]) {
    const statsByPlaylistId = new Map<
      string,
      { itemsCount: number; totalDuration: number }
    >();
    await Promise.all(
      playlistIds.map(async (playlistId) => {
        const items = await this.deps.playlistRepository.listItems(playlistId);
        statsByPlaylistId.set(playlistId, {
          itemsCount: items.length,
          totalDuration: items.reduce((sum, item) => sum + item.duration, 0),
        });
      }),
    );
    return statsByPlaylistId;
  }
}
