import {
  type ContentRecord,
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import {
  type PlaylistItemRecord,
  type PlaylistRepository,
} from "#/application/ports/playlists";
import { type UserRepository } from "#/application/ports/rbac";
import { NotFoundError } from "./errors";
import { toPlaylistItemView, toPlaylistView } from "./playlist-view";
import { findPlaylistByIdForOwner } from "./shared";

export class GetPlaylistUseCase {
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

  async execute(input: { id: string; ownerId?: string }) {
    const playlist = await findPlaylistByIdForOwner(
      this.deps.playlistRepository,
      input.id,
      input.ownerId,
    );
    if (!playlist) throw new NotFoundError("Playlist not found");

    const items = await this.deps.playlistRepository.listItems(input.id);
    const itemViews = await this.buildItems(items, input.ownerId);

    const owner = await this.deps.userRepository.findById(playlist.ownerId);
    return {
      ...toPlaylistView(playlist, owner?.name ?? null, {
        itemsCount: itemViews.length,
        totalDuration: itemViews.reduce((sum, item) => sum + item.duration, 0),
      }),
      items: itemViews,
    };
  }

  private async buildItems(items: PlaylistItemRecord[], ownerId?: string) {
    const contentIds = Array.from(new Set(items.map((item) => item.contentId)));
    const contents =
      ownerId && this.deps.contentRepository.findByIdsForOwner
        ? await this.deps.contentRepository.findByIdsForOwner(
            contentIds,
            ownerId,
          )
        : await this.deps.contentRepository.findByIds(contentIds);
    const contentById = new Map(
      contents.map((content) => [content.id, content]),
    );

    const views = [] as ReturnType<typeof toPlaylistItemView>[];
    for (const item of items) {
      const content = contentById.get(item.contentId);
      if (!content) {
        throw new NotFoundError("Content not found");
      }
      const thumbnailUrl = await this.buildThumbnailUrl(content);
      views.push(
        toPlaylistItemView(item, content, {
          thumbnailUrl: thumbnailUrl ?? null,
        }),
      );
    }
    return views;
  }
}
