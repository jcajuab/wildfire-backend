import { describe, expect, test } from "bun:test";
import { type ContentRecord } from "#/application/ports/content";
import { type DisplayRepository } from "#/application/ports/displays";
import {
  type PlaylistItemRecord,
  type PlaylistRecord,
  type PlaylistRepository,
} from "#/application/ports/playlists";
import { type UserRepository } from "#/application/ports/rbac";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  AddPlaylistItemUseCase,
  CreatePlaylistUseCase,
  DeletePlaylistUseCase,
  GetPlaylistUseCase,
  ListPlaylistsUseCase,
  NotFoundError,
  PlaylistInUseError,
} from "#/application/use-cases/playlists";

const makeDeps = () => {
  const playlists: PlaylistRecord[] = [];
  const items: PlaylistItemRecord[] = [];
  const contents: ContentRecord[] = [
    {
      id: "content-1",
      title: "Welcome",
      type: "IMAGE",
      status: "READY",
      fileKey: "content/images/a.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 100,
      width: 10,
      height: 10,
      duration: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    },
  ];

  const playlistRepository: PlaylistRepository = {
    list: async () => [...playlists],
    listForOwner: async (ownerId: string) =>
      playlists.filter((p) => p.ownerId === ownerId),
    listPageForOwner: async ({ ownerId, offset, limit }) => {
      const owned = playlists.filter((p) => p.ownerId === ownerId);
      return {
        items: owned.slice(offset, offset + limit),
        total: owned.length,
      };
    },
    listPage: async ({ offset, limit }) => ({
      items: playlists.slice(offset, offset + limit),
      total: playlists.length,
    }),
    findByIds: async (ids: string[]) =>
      playlists.filter((playlist) => ids.includes(playlist.id)),
    findByIdsForOwner: async (ids: string[], ownerId: string) =>
      playlists.filter((p) => ids.includes(p.id) && p.ownerId === ownerId),
    findById: async (id: string) =>
      playlists.find((playlist) => playlist.id === id) ?? null,
    findByIdForOwner: async (id: string, ownerId: string) =>
      playlists.find((p) => p.id === id && p.ownerId === ownerId) ?? null,
    create: async (input) => {
      const record: PlaylistRecord = {
        id: `playlist-${playlists.length + 1}`,
        name: input.name,
        description: input.description,
        status: "DRAFT",
        ownerId: input.ownerId,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      };
      playlists.push(record);
      return record;
    },
    update: async () => null,
    updateForOwner: async () => null,
    updateStatus: async () => undefined,
    delete: async () => false,
    deleteForOwner: async () => false,
    listItems: async (playlistId: string) =>
      items.filter((item) => item.playlistId === playlistId),
    listItemStatsByPlaylistIds: async (playlistIds: string[]) => {
      const stats = new Map<
        string,
        { itemsCount: number; totalDuration: number }
      >(playlistIds.map((id) => [id, { itemsCount: 0, totalDuration: 0 }]));
      for (const item of items) {
        if (!playlistIds.includes(item.playlistId)) continue;
        const current = stats.get(item.playlistId) ?? {
          itemsCount: 0,
          totalDuration: 0,
        };
        stats.set(item.playlistId, {
          itemsCount: current.itemsCount + 1,
          totalDuration: current.totalDuration + item.duration,
        });
      }
      return stats;
    },
    findItemById: async (id: string) =>
      items.find((item) => item.id === id) ?? null,
    countItemsByContentId: async (contentId: string) =>
      items.filter((item) => item.contentId === contentId).length,
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
    reorderItems: async () => true,
    deleteItem: async () => false,
  };

  const contentRepository = {
    findById: async (id: string) =>
      contents.find((content) => content.id === id) ?? null,
    findByIdForOwner: async (id: string, ownerId: string) =>
      contents.find((c) => c.id === id && c.ownerId === ownerId) ?? null,
    findByIds: async (ids: string[]) =>
      contents.filter((content) => ids.includes(content.id)),
    findByIdsForOwner: async (ids: string[], ownerId: string) =>
      contents.filter((c) => ids.includes(c.id) && c.ownerId === ownerId),
    create: async () => {
      throw new Error("not used");
    },
    list: async () => ({ items: [], total: 0 }),
    listForOwner: async () => ({ items: [], total: 0 }),
    delete: async () => false,
    deleteForOwner: async () => false,
    update: async () => null,
    updateForOwner: async () => null,
  };

  const userRepository: UserRepository = {
    list: async () => [],
    findById: async (id: string) =>
      id === "user-1"
        ? {
            id,
            username: "user",
            email: "user@example.com",
            name: "User",
            isActive: true,
          }
        : null,
    findByIds: async (ids: string[]) =>
      ids.includes("user-1")
        ? [
            {
              id: "user-1",
              username: "user",
              email: "user@example.com",
              name: "User",
              isActive: true,
            },
          ]
        : [],
    findByUsername: async () => null,
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
  test("ListPlaylistsUseCase returns playlists with owner", async () => {
    const deps = makeDeps();
    await deps.playlistRepository.create({
      name: "Morning",
      description: null,
      ownerId: "user-1",
    });

    const useCase = new ListPlaylistsUseCase({
      playlistRepository: deps.playlistRepository,
      userRepository: deps.userRepository,
    });

    const result = await useCase.execute();
    expect(result.items[0]?.owner.name).toBe("User");
  });

  test("ListPlaylistsUseCase uses batched playlist stats when available", async () => {
    const deps = makeDeps();
    await deps.playlistRepository.create({
      name: "Morning",
      description: null,
      ownerId: "user-1",
    });

    let listItemsCalls = 0;
    let listStatsCalls = 0;
    const playlistRepository: PlaylistRepository = {
      ...deps.playlistRepository,
      listItems: async (playlistId: string) => {
        listItemsCalls += 1;
        return deps.playlistRepository.listItems(playlistId);
      },
      listItemStatsByPlaylistIds: async (playlistIds: string[]) => {
        listStatsCalls += 1;
        const statsLoader = deps.playlistRepository.listItemStatsByPlaylistIds;
        if (!statsLoader) {
          return new Map();
        }
        return statsLoader(playlistIds);
      },
    };

    const useCase = new ListPlaylistsUseCase({
      playlistRepository,
      userRepository: deps.userRepository,
    });
    await useCase.execute();

    expect(listStatsCalls).toBe(1);
    expect(listItemsCalls).toBe(0);
  });

  test("CreatePlaylistUseCase returns playlist", async () => {
    const deps = makeDeps();
    const useCase = new CreatePlaylistUseCase({
      playlistRepository: deps.playlistRepository,
      userRepository: deps.userRepository,
    });

    const result = await useCase.execute({
      name: "Morning",
      ownerId: "user-1",
    });

    expect(result.name).toBe("Morning");
  });

  test("CreatePlaylistUseCase throws when owner is missing", async () => {
    const deps = makeDeps();
    const useCase = new CreatePlaylistUseCase({
      playlistRepository: deps.playlistRepository,
      userRepository: deps.userRepository,
    });

    await expect(
      useCase.execute({
        name: "Morning",
        ownerId: "missing-user",
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
      ownerId: "user-1",
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
      ownerId: "user-1",
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
      ownerId: "user-1",
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

  test("AddPlaylistItemUseCase rejects duplicate sequence within playlist", async () => {
    const deps = makeDeps();
    const playlist = await deps.playlistRepository.create({
      name: "Morning",
      description: null,
      ownerId: "user-1",
    });
    await deps.playlistRepository.addItem({
      playlistId: playlist.id,
      contentId: "content-1",
      sequence: 10,
      duration: 5,
    });

    const useCase = new AddPlaylistItemUseCase({
      playlistRepository: deps.playlistRepository,
      contentRepository: deps.contentRepository,
    });

    await expect(
      useCase.execute({
        playlistId: playlist.id,
        contentId: "content-1",
        sequence: 10,
        duration: 7,
      }),
    ).rejects.toBeInstanceOf(Error);
  });

  test("AddPlaylistItemUseCase disables impacted schedules when playlist exceeds window", async () => {
    const deps = makeDeps();
    const playlist = await deps.playlistRepository.create({
      name: "Morning",
      description: null,
      ownerId: "user-1",
    });
    const updates: Array<{ id: string; isActive?: boolean }> = [];
    const scheduleRepository: ScheduleRepository = {
      list: async () => [
        {
          id: "schedule-1",
          name: "Morning",
          kind: "PLAYLIST" as const,
          playlistId: playlist.id,
          contentId: null,
          displayId: "display-1",
          startTime: "08:00",
          endTime: "08:01",
          isActive: true,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
      listByDisplay: async () => [],
      findById: async () => null,
      create: async () => {
        throw new Error("not used");
      },
      update: async (id: string, input: { isActive?: boolean }) => {
        updates.push({ id, isActive: input.isActive });
        return null;
      },
      delete: async () => false,
      countByPlaylistId: async () => 0,
      countByContentId: async () => 0,
      listByContentId: async () => [],
      listByPlaylistId: async () => [],
    };
    const useCase = new AddPlaylistItemUseCase({
      playlistRepository: deps.playlistRepository,
      contentRepository: {
        ...deps.contentRepository,
        findById: async () => ({
          id: "content-1",
          title: "Tall Content",
          type: "IMAGE",
          status: "READY",
          fileKey: "content/images/a.png",
          checksum: "abc",
          mimeType: "image/png",
          fileSize: 100,
          width: 100,
          height: 3000,
          duration: null,
          ownerId: "user-1",
          createdAt: "2025-01-01T00:00:00.000Z",
        }),
        findByIds: async () => [
          {
            id: "content-1",
            title: "Tall Content",
            type: "IMAGE",
            status: "READY",
            fileKey: "content/images/a.png",
            checksum: "abc",
            mimeType: "image/png",
            fileSize: 100,
            width: 100,
            height: 3000,
            duration: null,
            ownerId: "user-1",
            createdAt: "2025-01-01T00:00:00.000Z",
          },
        ],
      },
      scheduleRepository,
      displayRepository: {
        list: async () => [],
        listPage: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
        findByIds: async () => [],
        findById: async () => ({
          id: "display-1",
          name: "Lobby",
          slug: "display-1",
          status: "READY",
          location: null,
          screenWidth: 1366,
          screenHeight: 768,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }),
        findBySlug: async () => null,
        findByFingerprint: async () => null,
        findByFingerprintAndOutput: async () => null,
        create: async () => {
          throw new Error("not used");
        },
        createRegisteredDisplay: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        setStatus: async () => {},
        touchSeen: async () => {},
        bumpRefreshNonce: async () => false,
        delete: async (_id: string) => false,
      },
    });

    await useCase.execute({
      playlistId: playlist.id,
      contentId: "content-1",
      sequence: 10,
      duration: 5,
    });
    expect(updates.some((entry) => entry.id === "schedule-1")).toBe(true);
  });

  test("AddPlaylistItemUseCase does not disable schedules when root PDF fits by document duration", async () => {
    const deps = makeDeps();
    const playlist = await deps.playlistRepository.create({
      name: "Morning",
      description: null,
      ownerId: "user-1",
    });
    const updates: Array<{ id: string; isActive?: boolean }> = [];
    const scheduleRepository: ScheduleRepository = {
      list: async () => [
        {
          id: "schedule-1",
          name: "Morning",
          kind: "PLAYLIST" as const,
          playlistId: playlist.id,
          contentId: null,
          displayId: "display-1",
          startTime: "08:00",
          endTime: "08:01",
          isActive: true,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
      listByDisplay: async () => [],
      findById: async () => null,
      create: async () => {
        throw new Error("not used");
      },
      update: async (id: string, input: { isActive?: boolean }) => {
        updates.push({ id, isActive: input.isActive });
        return null;
      },
      delete: async () => false,
      countByPlaylistId: async () => 0,
      countByContentId: async () => 0,
      listByContentId: async () => [],
      listByPlaylistId: async () => [],
    };
    const useCase = new AddPlaylistItemUseCase({
      playlistRepository: deps.playlistRepository,
      contentRepository: {
        ...deps.contentRepository,
        findById: async () => ({
          id: "content-pdf-root",
          title: "Manual",
          type: "PDF",
          kind: "ROOT",
          status: "READY",
          fileKey: "content/documents/manual.pdf",
          checksum: "root-checksum",
          mimeType: "application/pdf",
          fileSize: 100,
          width: null,
          height: null,
          duration: null,
          ownerId: "user-1",
          createdAt: "2025-01-01T00:00:00.000Z",
        }),
        findByIds: async () => [
          {
            id: "content-pdf-root",
            title: "Manual",
            type: "PDF",
            kind: "ROOT",
            status: "READY",
            fileKey: "content/documents/manual.pdf",
            checksum: "root-checksum",
            mimeType: "application/pdf",
            fileSize: 100,
            width: null,
            height: null,
            duration: null,
            ownerId: "user-1",
            createdAt: "2025-01-01T00:00:00.000Z",
          },
        ],
        findChildrenByParentIds: async () => [
          {
            id: "content-pdf-page-1",
            title: "Manual Page 1",
            type: "PDF",
            kind: "PAGE",
            parentContentId: "content-pdf-root",
            pageNumber: 1,
            status: "READY",
            fileKey: "content/documents/manual-page-1.pdf",
            checksum: "page-1-checksum",
            mimeType: "application/pdf",
            fileSize: 50,
            width: null,
            height: null,
            duration: null,
            ownerId: "user-1",
            createdAt: "2025-01-01T00:00:00.000Z",
          },
          {
            id: "content-pdf-page-2",
            title: "Manual Page 2",
            type: "PDF",
            kind: "PAGE",
            parentContentId: "content-pdf-root",
            pageNumber: 2,
            status: "READY",
            fileKey: "content/documents/manual-page-2.pdf",
            checksum: "page-2-checksum",
            mimeType: "application/pdf",
            fileSize: 50,
            width: null,
            height: null,
            duration: null,
            ownerId: "user-1",
            createdAt: "2025-01-01T00:00:00.000Z",
          },
        ],
      },
      scheduleRepository,
      displayRepository: {
        list: async () => [],
        listPage: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
        findByIds: async () => [],
        findById: async () => ({
          id: "display-1",
          name: "Lobby",
          slug: "display-1",
          status: "READY",
          location: null,
          screenWidth: 1366,
          screenHeight: 768,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }),
        findBySlug: async () => null,
        findByFingerprint: async () => null,
        findByFingerprintAndOutput: async () => null,
        create: async () => {
          throw new Error("not used");
        },
        createRegisteredDisplay: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        setStatus: async () => {},
        touchSeen: async () => {},
        bumpRefreshNonce: async () => false,
        delete: async (_id: string) => false,
      },
    });

    await useCase.execute({
      playlistId: playlist.id,
      contentId: "content-pdf-root",
      sequence: 10,
      duration: 40,
    });

    expect(updates).toHaveLength(0);
  });

  test("DeletePlaylistUseCase throws PlaylistInUseError when playlist is in use by one display", async () => {
    const deps = makeDeps();
    const playlist = await deps.playlistRepository.create({
      name: "Morning",
      description: null,
      ownerId: "user-1",
    });

    const scheduleRepository: ScheduleRepository = {
      list: async () => [],
      listByDisplay: async () => [],
      listByPlaylistId: async () => [
        {
          id: "s1",
          name: "Morning",
          kind: "PLAYLIST" as const,
          playlistId: playlist.id,
          contentId: null,
          displayId: "display-1",
          startTime: "08:00",
          endTime: "18:00",
          isActive: true,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
      findById: async () => null,
      create: async () => {
        throw new Error("not used");
      },
      update: async () => null,
      delete: async () => false,
      countByPlaylistId: async () => 1,
    };

    const displayRepository: DisplayRepository = {
      list: async () => [],
      listPage: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
      findByIds: async (ids: string[]) =>
        ids.map((id) => ({
          id,
          name: "Lobby TV",
          slug: id,
          status: "READY",
          location: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        })),
      findById: async () => null,
      findBySlug: async () => null,
      findByFingerprint: async () => null,
      findByFingerprintAndOutput: async () => null,
      create: async () => {
        throw new Error("not used");
      },
      createRegisteredDisplay: async () => {
        throw new Error("not used");
      },
      update: async () => null,
      setStatus: async () => {},
      touchSeen: async () => {},
      bumpRefreshNonce: async () => false,
      delete: async (_id: string) => false,
    };

    const useCase = new DeletePlaylistUseCase({
      playlistRepository: deps.playlistRepository,
      contentRepository: deps.contentRepository,
      scheduleRepository,
      displayRepository,
    });

    const err = await useCase.execute({ id: playlist.id }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PlaylistInUseError);
    expect((err as PlaylistInUseError).message).toContain("Lobby TV");
  });

  test("DeletePlaylistUseCase throws PlaylistInUseError with multiple displays message when in use by more than one display", async () => {
    const deps = makeDeps();
    const playlist = await deps.playlistRepository.create({
      name: "Morning",
      description: null,
      ownerId: "user-1",
    });

    const scheduleRepository: ScheduleRepository = {
      list: async () => [],
      listByDisplay: async () => [],
      listByPlaylistId: async () => [
        {
          id: "s1",
          name: "Morning",
          kind: "PLAYLIST" as const,
          playlistId: playlist.id,
          contentId: null,
          displayId: "display-1",
          startTime: "08:00",
          endTime: "18:00",
          isActive: true,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
        {
          id: "s2",
          name: "Evening",
          playlistId: playlist.id,
          displayId: "display-2",
          startTime: "18:00",
          endTime: "22:00",
          isActive: true,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
      findById: async () => null,
      create: async () => {
        throw new Error("not used");
      },
      update: async () => null,
      delete: async () => false,
      countByPlaylistId: async () => 2,
    };

    const displayRepository: DisplayRepository = {
      list: async () => [],
      listPage: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
      findByIds: async (ids: string[]) =>
        ids.map((id) => ({
          id,
          name: "Display",
          slug: id,
          status: "READY",
          location: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        })),
      findById: async () => null,
      findBySlug: async () => null,
      findByFingerprint: async () => null,
      findByFingerprintAndOutput: async () => null,
      create: async () => {
        throw new Error("not used");
      },
      createRegisteredDisplay: async () => {
        throw new Error("not used");
      },
      update: async () => null,
      setStatus: async () => {},
      touchSeen: async () => {},
      bumpRefreshNonce: async () => false,
      delete: async (_id: string) => false,
    };

    const useCase = new DeletePlaylistUseCase({
      playlistRepository: deps.playlistRepository,
      contentRepository: deps.contentRepository,
      scheduleRepository,
      displayRepository,
    });

    const err = await useCase.execute({ id: playlist.id }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PlaylistInUseError);
    expect((err as PlaylistInUseError).message).toContain("multiple displays");
  });

  test("DeletePlaylistUseCase deletes when playlist is not in use", async () => {
    const deps = makeDeps();
    const playlist = await deps.playlistRepository.create({
      name: "Morning",
      description: null,
      ownerId: "user-1",
    });

    let deleteCalled = false;
    const playlistRepository = {
      ...deps.playlistRepository,
      delete: async (id: string) => {
        if (id === playlist.id) {
          deleteCalled = true;
          return true;
        }
        return false;
      },
    };

    const scheduleRepository: ScheduleRepository = {
      list: async () => [],
      listByDisplay: async () => [],
      listByPlaylistId: async () => [],
      findById: async () => null,
      create: async () => {
        throw new Error("not used");
      },
      update: async () => null,
      delete: async () => false,
      countByPlaylistId: async () => 0,
    };

    const displayRepository: DisplayRepository = {
      list: async () => [],
      listPage: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
      findByIds: async () => [],
      findById: async () => null,
      findBySlug: async () => null,
      findByFingerprint: async () => null,
      findByFingerprintAndOutput: async () => null,
      create: async () => {
        throw new Error("not used");
      },
      createRegisteredDisplay: async () => {
        throw new Error("not used");
      },
      update: async () => null,
      setStatus: async () => {},
      touchSeen: async () => {},
      bumpRefreshNonce: async () => false,
      delete: async (_id: string) => false,
    };

    const useCase = new DeletePlaylistUseCase({
      playlistRepository,
      contentRepository: deps.contentRepository,
      scheduleRepository,
      displayRepository,
    });

    await useCase.execute({ id: playlist.id });
    expect(deleteCalled).toBe(true);
  });
});
