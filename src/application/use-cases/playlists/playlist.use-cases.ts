import { ValidationError } from "#/application/errors/validation";
import { type ContentRepository } from "#/application/ports/content";
import {
  type PlaylistItemRecord,
  type PlaylistRepository,
} from "#/application/ports/playlists";
import { type UserRepository } from "#/application/ports/rbac";
import {
  isValidDuration,
  isValidSequence,
  type PlaylistStatus,
} from "#/domain/playlists/playlist";
import { NotFoundError } from "./errors";
import { toPlaylistItemView, toPlaylistView } from "./playlist-view";

export class ListPlaylistsUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input?: {
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

    const { items: playlists, total } =
      await this.deps.playlistRepository.listPage({
        offset,
        limit: pageSize,
        status: input?.status,
        search: input?.search,
        sortBy: input?.sortBy,
        sortDirection: input?.sortDirection,
      });
    const creatorIds = Array.from(
      new Set(playlists.map((item) => item.createdById)),
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
        creatorsById.get(playlist.createdById)?.name ?? null,
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
    createdById: string;
  }) {
    const creator = await this.deps.userRepository.findById(input.createdById);
    if (!creator) {
      throw new NotFoundError("User not found");
    }

    const playlist = await this.deps.playlistRepository.create({
      name: input.name,
      description: input.description ?? null,
      createdById: input.createdById,
    });
    return toPlaylistView(playlist, creator.name, {
      itemsCount: 0,
      totalDuration: 0,
    });
  }
}

export class GetPlaylistUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input: { id: string }) {
    const playlist = await this.deps.playlistRepository.findById(input.id);
    if (!playlist) throw new NotFoundError("Playlist not found");

    const items = await this.deps.playlistRepository.listItems(input.id);
    const itemViews = await this.buildItems(items);

    const creator = await this.deps.userRepository.findById(
      playlist.createdById,
    );
    return {
      ...toPlaylistView(playlist, creator?.name ?? null, {
        itemsCount: itemViews.length,
        totalDuration: itemViews.reduce((sum, item) => sum + item.duration, 0),
      }),
      items: itemViews,
    };
  }

  private async buildItems(items: PlaylistItemRecord[]) {
    const contentIds = Array.from(new Set(items.map((item) => item.contentId)));
    const contents = await this.deps.contentRepository.findByIds(contentIds);
    const contentById = new Map(
      contents.map((content) => [content.id, content]),
    );

    const views = [] as ReturnType<typeof toPlaylistItemView>[];
    for (const item of items) {
      const content = contentById.get(item.contentId);
      if (!content) {
        throw new NotFoundError("Content not found");
      }
      views.push(toPlaylistItemView(item, content));
    }
    return views;
  }
}

export class UpdatePlaylistUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input: {
    id: string;
    name?: string;
    description?: string | null;
  }) {
    const playlist = await this.deps.playlistRepository.update(input.id, {
      name: input.name,
      description: input.description,
    });
    if (!playlist) throw new NotFoundError("Playlist not found");

    const creator = await this.deps.userRepository.findById(
      playlist.createdById,
    );
    const items = await this.deps.playlistRepository.listItems(playlist.id);
    return toPlaylistView(playlist, creator?.name ?? null, {
      itemsCount: items.length,
      totalDuration: items.reduce((sum, item) => sum + item.duration, 0),
    });
  }
}

export class DeletePlaylistUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
    },
  ) {}

  async execute(input: { id: string }) {
    const playlistItems = await this.deps.playlistRepository.listItems(
      input.id,
    );
    const deleted = await this.deps.playlistRepository.delete(input.id);
    if (!deleted) throw new NotFoundError("Playlist not found");

    const affectedContentIds = Array.from(
      new Set(playlistItems.map((item) => item.contentId)),
    );
    await Promise.all(
      affectedContentIds.map(async (contentId) => {
        const references =
          await this.deps.playlistRepository.countItemsByContentId(contentId);
        if (references === 0) {
          await this.deps.contentRepository.update(contentId, {
            status: "DRAFT",
          });
        }
      }),
    );
  }
}

export class AddPlaylistItemUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
    },
  ) {}

  async execute(input: {
    playlistId: string;
    contentId: string;
    sequence: number;
    duration: number;
  }) {
    if (!isValidSequence(input.sequence)) {
      throw new ValidationError("Invalid sequence");
    }
    if (!isValidDuration(input.duration)) {
      throw new ValidationError("Invalid duration");
    }

    const playlist = await this.deps.playlistRepository.findById(
      input.playlistId,
    );
    if (!playlist) throw new NotFoundError("Playlist not found");

    const content = await this.deps.contentRepository.findById(input.contentId);
    if (!content) throw new NotFoundError("Content not found");

    const existingItems = await this.deps.playlistRepository.listItems(
      input.playlistId,
    );
    if (existingItems.some((item) => item.sequence === input.sequence)) {
      throw new ValidationError("Sequence already exists in playlist");
    }

    const item = await this.deps.playlistRepository.addItem({
      playlistId: input.playlistId,
      contentId: input.contentId,
      sequence: input.sequence,
      duration: input.duration,
    });
    await this.deps.contentRepository.update(input.contentId, {
      status: "IN_USE",
    });

    return toPlaylistItemView(item, content);
  }
}

export class UpdatePlaylistItemUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
    },
  ) {}

  async execute(input: { id: string; sequence?: number; duration?: number }) {
    if (input.sequence !== undefined && !isValidSequence(input.sequence)) {
      throw new ValidationError("Invalid sequence");
    }
    if (input.duration !== undefined && !isValidDuration(input.duration)) {
      throw new ValidationError("Invalid duration");
    }

    const item = await this.deps.playlistRepository.updateItem(input.id, {
      sequence: input.sequence,
      duration: input.duration,
    });
    if (!item) throw new NotFoundError("Playlist item not found");

    const content = await this.deps.contentRepository.findById(item.contentId);
    if (!content) throw new NotFoundError("Content not found");

    return toPlaylistItemView(item, content);
  }
}

export class DeletePlaylistItemUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
    },
  ) {}

  async execute(input: { id: string }) {
    const existing = await this.deps.playlistRepository.findItemById(input.id);
    if (!existing) throw new NotFoundError("Playlist item not found");

    const deleted = await this.deps.playlistRepository.deleteItem(input.id);
    if (!deleted) throw new NotFoundError("Playlist item not found");

    const references = await this.deps.playlistRepository.countItemsByContentId(
      existing.contentId,
    );
    if (references === 0) {
      await this.deps.contentRepository.update(existing.contentId, {
        status: "DRAFT",
      });
    }
  }
}
