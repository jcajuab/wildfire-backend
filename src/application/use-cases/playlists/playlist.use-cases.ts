import { type ContentRepository } from "#/application/ports/content";
import {
  type PlaylistItemRecord,
  type PlaylistRepository,
} from "#/application/ports/playlists";
import { type UserRepository } from "#/application/ports/rbac";
import { isValidDuration, isValidSequence } from "#/domain/playlists/playlist";
import { NotFoundError } from "./errors";
import { toPlaylistItemView, toPlaylistView } from "./playlist-view";

export class ListPlaylistsUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      userRepository: UserRepository;
    },
  ) {}

  async execute() {
    const playlists = await this.deps.playlistRepository.list();
    const creatorIds = Array.from(
      new Set(playlists.map((item) => item.createdById)),
    );
    const creators = await this.deps.userRepository.findByIds(creatorIds);
    const creatorsById = new Map(creators.map((user) => [user.id, user]));

    return playlists.map((playlist) =>
      toPlaylistView(
        playlist,
        creatorsById.get(playlist.createdById)?.name ?? null,
      ),
    );
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
    return toPlaylistView(playlist, creator.name);
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
      ...toPlaylistView(playlist, creator?.name ?? null),
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
    return toPlaylistView(playlist, creator?.name ?? null);
  }
}

export class DeletePlaylistUseCase {
  constructor(
    private readonly deps: { playlistRepository: PlaylistRepository },
  ) {}

  async execute(input: { id: string }) {
    const deleted = await this.deps.playlistRepository.delete(input.id);
    if (!deleted) throw new NotFoundError("Playlist not found");
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
      throw new Error("Invalid sequence");
    }
    if (!isValidDuration(input.duration)) {
      throw new Error("Invalid duration");
    }

    const playlist = await this.deps.playlistRepository.findById(
      input.playlistId,
    );
    if (!playlist) throw new NotFoundError("Playlist not found");

    const content = await this.deps.contentRepository.findById(input.contentId);
    if (!content) throw new NotFoundError("Content not found");

    const item = await this.deps.playlistRepository.addItem({
      playlistId: input.playlistId,
      contentId: input.contentId,
      sequence: input.sequence,
      duration: input.duration,
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
      throw new Error("Invalid sequence");
    }
    if (input.duration !== undefined && !isValidDuration(input.duration)) {
      throw new Error("Invalid duration");
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
    private readonly deps: { playlistRepository: PlaylistRepository },
  ) {}

  async execute(input: { id: string }) {
    const deleted = await this.deps.playlistRepository.deleteItem(input.id);
    if (!deleted) throw new NotFoundError("Playlist item not found");
  }
}
