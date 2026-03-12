import {
  type ContentRecord,
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type UserRepository } from "#/application/ports/rbac";
import { type PlaylistStatus } from "#/domain/playlists/playlist";
import { toPlaylistItemView, toPlaylistView } from "./playlist-view";
import { listPlaylistPageForOwner } from "./shared";

export class ListPlaylistsUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      userRepository: UserRepository;
      contentStorage?: ContentStorage;
      thumbnailUrlExpiresInSeconds?: number;
    },
  ) {}

  private async buildThumbnailUrl(
    content: ContentRecord,
  ): Promise<string | undefined> {
    if (!content.thumbnailKey || !this.deps.contentStorage) {
      return undefined;
    }

    try {
      return await this.deps.contentStorage.getPresignedDownloadUrl({
        key: content.thumbnailKey,
        expiresInSeconds: this.deps.thumbnailUrlExpiresInSeconds ?? 3600,
      });
    } catch {
      return undefined;
    }
  }

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
    const previewItemsByPlaylistId = await this.buildPreviewItemsByPlaylistId({
      playlistIds,
      ownerId: input?.ownerId,
    });

    const items = playlists.map((playlist) =>
      toPlaylistView(
        playlist,
        creatorsById.get(playlist.ownerId)?.name ?? null,
        statsByPlaylistId.get(playlist.id),
        {
          previewItems: previewItemsByPlaylistId.get(playlist.id) ?? [],
        },
      ),
    );

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  private async buildPreviewItemsByPlaylistId(input: {
    playlistIds: string[];
    ownerId?: string;
  }) {
    const previewItemsByPlaylistId = new Map<
      string,
      ReturnType<typeof toPlaylistItemView>[]
    >();

    const playlistItemsByPlaylistId = await Promise.all(
      input.playlistIds.map(async (playlistId) => {
        const items = await this.deps.playlistRepository.listItems(playlistId);
        return {
          playlistId,
          items: [...items].sort(
            (left, right) => left.sequence - right.sequence,
          ),
        };
      }),
    );

    const contentIds = Array.from(
      new Set(
        playlistItemsByPlaylistId.flatMap((entry) =>
          entry.items.map((item) => item.contentId),
        ),
      ),
    );

    const contents =
      contentIds.length === 0
        ? []
        : input.ownerId && this.deps.contentRepository.findByIdsForOwner
          ? await this.deps.contentRepository.findByIdsForOwner(
              contentIds,
              input.ownerId,
            )
          : await this.deps.contentRepository.findByIds(contentIds);

    const contentById = new Map(
      contents.map((content) => [content.id, content]),
    );

    for (const entry of playlistItemsByPlaylistId) {
      const previewItems: ReturnType<typeof toPlaylistItemView>[] = [];

      for (const item of entry.items) {
        const content = contentById.get(item.contentId);
        if (!content) {
          continue;
        }

        const thumbnailUrl = await this.buildThumbnailUrl(content);
        previewItems.push(
          toPlaylistItemView(item, content, {
            thumbnailUrl: thumbnailUrl ?? null,
          }),
        );

        if (previewItems.length === 3) {
          break;
        }
      }

      previewItemsByPlaylistId.set(entry.playlistId, previewItems);
    }

    return previewItemsByPlaylistId;
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
