import { describe, expect, test } from "bun:test";
import { type ContentRecord } from "#/application/ports/content";
import {
  type PlaylistItemRecord,
  type PlaylistRecord,
  type PlaylistRepository,
} from "#/application/ports/playlists";
import { type UserRepository } from "#/application/ports/rbac";
import {
  AddPlaylistItemUseCase,
  CreatePlaylistUseCase,
  GetPlaylistUseCase,
  ListPlaylistsUseCase,
  NotFoundError,
} from "#/application/use-cases/playlists";

const makeDeps = () => {
  const playlists: PlaylistRecord[] = [];
  const items: PlaylistItemRecord[] = [];
  const contents: ContentRecord[] = [
    {
      id: "content-1",
      title: "Welcome",
      type: "IMAGE",
      fileKey: "content/images/a.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 100,
      width: 10,
      height: 10,
      duration: null,
      createdById: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    },
  ];

  const playlistRepository: PlaylistRepository = {
    list: async () => [...playlists],
    findByIds: async (ids: string[]) =>
      playlists.filter((playlist) => ids.includes(playlist.id)),
    findById: async (id: string) =>
      playlists.find((playlist) => playlist.id === id) ?? null,
    create: async (input) => {
      const record: PlaylistRecord = {
        id: `playlist-${playlists.length + 1}`,
        name: input.name,
        description: input.description,
        createdById: input.createdById,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      };
      playlists.push(record);
      return record;
    },
    update: async () => null,
    delete: async () => false,
    listItems: async (playlistId: string) =>
      items.filter((item) => item.playlistId === playlistId),
    addItem: async (input) => {
      const record: PlaylistItemRecord = {
        id: `item-${items.length + 1}`,
        playlistId: input.playlistId,
        contentId: input.contentId,
        sequence: input.sequence,
        duration: input.duration,
      };
      items.push(record);
      return record;
    },
    updateItem: async () => null,
    deleteItem: async () => false,
  };

  const contentRepository = {
    findById: async (id: string) =>
      contents.find((content) => content.id === id) ?? null,
    findByIds: async (ids: string[]) =>
      contents.filter((content) => ids.includes(content.id)),
    create: async () => {
      throw new Error("not used");
    },
    list: async () => ({ items: [], total: 0 }),
    delete: async () => false,
  };

  const userRepository: UserRepository = {
    list: async () => [],
    findById: async (id: string) =>
      id === "user-1"
        ? { id, email: "user@example.com", name: "User", isActive: true }
        : null,
    findByIds: async (ids: string[]) =>
      ids.includes("user-1")
        ? [
            {
              id: "user-1",
              email: "user@example.com",
              name: "User",
              isActive: true,
            },
          ]
        : [],
    findByEmail: async () => null,
    create: async () => {
      throw new Error("not used");
    },
    update: async () => null,
    delete: async () => false,
  };

  return {
    playlists,
    items,
    playlistRepository,
    contentRepository,
    userRepository,
  };
};

describe("Playlists use cases", () => {
  test("ListPlaylistsUseCase returns playlists with creator", async () => {
    const deps = makeDeps();
    await deps.playlistRepository.create({
      name: "Morning",
      description: null,
      createdById: "user-1",
    });

    const useCase = new ListPlaylistsUseCase({
      playlistRepository: deps.playlistRepository,
      userRepository: deps.userRepository,
    });

    const result = await useCase.execute();
    expect(result[0]?.createdBy.name).toBe("User");
  });

  test("CreatePlaylistUseCase returns playlist", async () => {
    const deps = makeDeps();
    const useCase = new CreatePlaylistUseCase({
      playlistRepository: deps.playlistRepository,
      userRepository: deps.userRepository,
    });

    const result = await useCase.execute({
      name: "Morning",
      createdById: "user-1",
    });

    expect(result.name).toBe("Morning");
  });

  test("CreatePlaylistUseCase throws when creator is missing", async () => {
    const deps = makeDeps();
    const useCase = new CreatePlaylistUseCase({
      playlistRepository: deps.playlistRepository,
      userRepository: deps.userRepository,
    });

    await expect(
      useCase.execute({
        name: "Morning",
        createdById: "missing-user",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("GetPlaylistUseCase throws when missing", async () => {
    const deps = makeDeps();
    const useCase = new GetPlaylistUseCase({
      playlistRepository: deps.playlistRepository,
      contentRepository: deps.contentRepository,
      userRepository: deps.userRepository,
    });

    await expect(useCase.execute({ id: "missing" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("GetPlaylistUseCase returns items", async () => {
    const deps = makeDeps();
    const playlist = await deps.playlistRepository.create({
      name: "Morning",
      description: null,
      createdById: "user-1",
    });
    await deps.playlistRepository.addItem({
      playlistId: playlist.id,
      contentId: "content-1",
      sequence: 10,
      duration: 5,
    });

    const useCase = new GetPlaylistUseCase({
      playlistRepository: deps.playlistRepository,
      contentRepository: deps.contentRepository,
      userRepository: deps.userRepository,
    });

    const result = await useCase.execute({ id: playlist.id });
    expect(result.items).toHaveLength(1);
  });

  test("GetPlaylistUseCase batches content lookups", async () => {
    const deps = makeDeps();
    const playlist = await deps.playlistRepository.create({
      name: "Morning",
      description: null,
      createdById: "user-1",
    });
    await deps.playlistRepository.addItem({
      playlistId: playlist.id,
      contentId: "content-1",
      sequence: 10,
      duration: 5,
    });
    await deps.playlistRepository.addItem({
      playlistId: playlist.id,
      contentId: "content-1",
      sequence: 20,
      duration: 5,
    });

    let findByIdCalls = 0;
    let findByIdsCalls = 0;
    const contentRepository = {
      findById: async (id: string) => {
        findByIdCalls += 1;
        return deps.contentRepository.findById(id);
      },
      findByIds: async (ids: string[]) => {
        findByIdsCalls += 1;
        return Promise.all(
          ids.map(async (id) => deps.contentRepository.findById(id)),
        ).then((rows) => rows.filter((row) => row != null));
      },
      create: async () => {
        throw new Error("not used");
      },
      list: async () => ({ items: [], total: 0 }),
      delete: async () => false,
    };

    const useCase = new GetPlaylistUseCase({
      playlistRepository: deps.playlistRepository,
      contentRepository: contentRepository as never,
      userRepository: deps.userRepository,
    });

    await useCase.execute({ id: playlist.id });
    expect(findByIdsCalls).toBe(1);
    expect(findByIdCalls).toBe(0);
  });

  test("AddPlaylistItemUseCase validates sequence", async () => {
    const deps = makeDeps();
    const playlist = await deps.playlistRepository.create({
      name: "Morning",
      description: null,
      createdById: "user-1",
    });
    const useCase = new AddPlaylistItemUseCase({
      playlistRepository: deps.playlistRepository,
      contentRepository: deps.contentRepository,
    });

    await expect(
      useCase.execute({
        playlistId: playlist.id,
        contentId: "content-1",
        sequence: 0,
        duration: 5,
      }),
    ).rejects.toBeInstanceOf(Error);
  });
});
