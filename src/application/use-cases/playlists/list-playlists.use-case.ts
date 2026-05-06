import {
  type ContentRecord,
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import {
  type PlaylistItemRecord,
  type PlaylistListSortBy,
  type PlaylistRepository,
} from "#/application/ports/playlists";
import { type UserRepository } from "#/application/ports/rbac";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { type PlaylistStatus } from "#/domain/playlists/playlist";
import { selectActiveSchedule } from "#/domain/schedules/schedule";
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
      scheduleRepository?: ScheduleRepository;
      timezone?: string;
    },
  ) {}

  private async buildThumbnailUrlMap(
    contents: readonly ContentRecord[],
  ): Promise<Map<string, string>> {
    const thumbnailKeys = Array.from(
      new Set(
        contents
          .map((content) => content.thumbnailKey)
          .filter(
            (key): key is string => typeof key === "string" && key.length > 0,
          ),
      ),
    );

    const thumbnailUrlByKey = new Map<string, string>();
    await Promise.all(
      thumbnailKeys.map(async (thumbnailKey) => {
        try {
          const thumbnailUrl =
            await this.deps.contentStorage?.getPresignedDownloadUrl({
              key: thumbnailKey,
              expiresInSeconds: this.deps.thumbnailUrlExpiresInSeconds ?? 3600,
            });
          if (thumbnailUrl) {
            thumbnailUrlByKey.set(thumbnailKey, thumbnailUrl);
          }
        } catch {
          // Best-effort enrichment only.
        }
      }),
    );

    return thumbnailUrlByKey;
  }

  async execute(input?: {
    ownerId?: string;
    page?: number;
    pageSize?: number;
    status?: PlaylistStatus;
    search?: string;
    sortBy?: PlaylistListSortBy;
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
    const playlistIds = playlists.map((playlist) => playlist.id);
    const creatorIds = Array.from(
      new Set(playlists.map((item) => item.ownerId)),
    );
    const [
      creators,
      statsByPlaylistId,
      previewItemsByPlaylistId,
      activePlaylistIds,
    ] = await Promise.all([
      this.deps.userRepository.findByIds(creatorIds),
      this.deps.playlistRepository.listItemStatsByPlaylistIds
        ? this.deps.playlistRepository.listItemStatsByPlaylistIds(playlistIds)
        : this.buildStatsByPlaylistId(playlistIds),
      this.buildPreviewItemsByPlaylistId({
        playlistIds,
        ownerId: input?.ownerId,
      }),
      this.computeActivePlaylistIds(playlistIds),
    ]);
    const creatorsById = new Map(creators.map((user) => [user.id, user]));

    const items = playlists.map((playlist) => {
      const view = toPlaylistView(
        playlist,
        creatorsById.get(playlist.ownerId) ?? null,
        statsByPlaylistId.get(playlist.id),
        {
          previewItems: previewItemsByPlaylistId.get(playlist.id) ?? [],
        },
      );
      return {
        ...view,
        status: activePlaylistIds.has(playlist.id)
          ? ("IN_USE" as const)
          : ("DRAFT" as const),
      };
    });

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

    const playlistItems =
      this.deps.playlistRepository.listItemsByPlaylistIds != null
        ? await this.deps.playlistRepository.listItemsByPlaylistIds(
            input.playlistIds,
          )
        : (
            await Promise.all(
              input.playlistIds.map(async (playlistId) => ({
                playlistId,
                items: await this.deps.playlistRepository.listItems(playlistId),
              })),
            )
          ).flatMap((entry) => entry.items);

    const playlistItemsByPlaylistId = new Map<string, PlaylistItemRecord[]>();
    for (const playlistId of input.playlistIds) {
      playlistItemsByPlaylistId.set(playlistId, []);
    }
    for (const item of playlistItems) {
      const existingItems =
        playlistItemsByPlaylistId.get(item.playlistId) ?? [];
      existingItems.push(item);
      playlistItemsByPlaylistId.set(item.playlistId, existingItems);
    }

    const previewCandidateItemsByPlaylistId = new Map<
      string,
      PlaylistItemRecord[]
    >();
    for (const [playlistId, itemsForPlaylist] of playlistItemsByPlaylistId) {
      previewCandidateItemsByPlaylistId.set(
        playlistId,
        [...itemsForPlaylist].sort(
          (left, right) => left.sequence - right.sequence,
        ),
      );
    }

    const contentIds = Array.from(
      new Set(
        [...previewCandidateItemsByPlaylistId.values()].flatMap((items) =>
          items.map((item) => item.contentId),
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
    const thumbnailUrlByKey = await this.buildThumbnailUrlMap(contents);

    for (const [playlistId, rawItems] of previewCandidateItemsByPlaylistId) {
      const previewItems: ReturnType<typeof toPlaylistItemView>[] = [];
      for (const item of rawItems) {
        const content = contentById.get(item.contentId);
        if (!content) {
          continue;
        }

        previewItems.push(
          toPlaylistItemView(item, content, {
            thumbnailUrl: content.thumbnailKey
              ? (thumbnailUrlByKey.get(content.thumbnailKey) ?? null)
              : null,
          }),
        );

        if (previewItems.length === 3) {
          break;
        }
      }

      previewItemsByPlaylistId.set(playlistId, previewItems);
    }

    return previewItemsByPlaylistId;
  }

  private async computeActivePlaylistIds(
    playlistIds: string[],
  ): Promise<Set<string>> {
    if (!this.deps.scheduleRepository || playlistIds.length === 0) {
      return new Set();
    }
    const now = new Date();
    const tz = this.deps.timezone ?? "Asia/Manila";
    const activeIds = new Set<string>();
    await Promise.all(
      playlistIds.map(async (playlistId) => {
        const schedules =
          (await this.deps.scheduleRepository?.listByPlaylistId(playlistId)) ??
          [];
        const active = selectActiveSchedule(schedules, now, tz);
        if (active) {
          activeIds.add(playlistId);
        }
      }),
    );
    return activeIds;
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
