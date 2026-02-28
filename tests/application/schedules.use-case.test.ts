import { describe, expect, test } from "bun:test";
import { ValidationError } from "#/application/errors/validation";
import { type DisplayRepository } from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  CreateScheduleUseCase,
  GetActiveScheduleForDisplayUseCase,
  ListSchedulesUseCase,
  NotFoundError,
  ScheduleConflictError,
  UpdateScheduleUseCase,
} from "#/application/use-cases/schedules";

const makeDeps = () => {
  const schedules = [] as Array<{
    id: string;
    seriesId?: string;
    name: string;
    playlistId: string;
    displayId: string;
    startDate?: string;
    endDate?: string;
    startTime: string;
    endTime: string;
    dayOfWeek?: number;
    priority: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  }>;

  const scheduleRepository: ScheduleRepository = {
    list: async () => [...schedules],
    listByDisplay: async (displayId: string) =>
      schedules.filter((schedule) => schedule.displayId === displayId),
    listBySeries: async (seriesId: string) =>
      schedules.filter((schedule) => schedule.seriesId === seriesId),
    findById: async (id: string) =>
      schedules.find((schedule) => schedule.id === id) ?? null,
    create: async (input) => {
      const record = {
        id: `schedule-${schedules.length + 1}`,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        ...input,
      };
      schedules.push(record);
      return record;
    },
    update: async (id, input) => {
      const index = schedules.findIndex((schedule) => schedule.id === id);
      if (index === -1) return null;
      const current = schedules[index];
      if (!current) return null;
      const next = {
        ...current,
        ...input,
        updatedAt: "2025-01-01T00:00:00.000Z",
      };
      schedules[index] = next;
      return next;
    },
    delete: async (id: string) => {
      const index = schedules.findIndex((schedule) => schedule.id === id);
      if (index === -1) return false;
      schedules.splice(index, 1);
      return true;
    },
    deleteBySeries: async (seriesId: string) => {
      const before = schedules.length;
      const remaining = schedules.filter(
        (schedule) => schedule.seriesId !== seriesId,
      );
      schedules.splice(0, schedules.length, ...remaining);
      return before - schedules.length;
    },
    countByPlaylistId: async (playlistId: string) =>
      schedules.filter((schedule) => schedule.playlistId === playlistId).length,
    listByPlaylistId: async (playlistId: string) =>
      schedules.filter((schedule) => schedule.playlistId === playlistId),
  };

  const playlistRepository: PlaylistRepository = {
    list: async () => [],
    listPage: async () => ({ items: [], total: 0 }),
    findByIds: async (ids: string[]) =>
      ids
        .map((id) =>
          id === "playlist-1"
            ? {
                id,
                name: "Morning",
                description: null,
                createdById: "user-1",
                createdAt: "2025-01-01T00:00:00.000Z",
                updatedAt: "2025-01-01T00:00:00.000Z",
              }
            : null,
        )
        .filter((row): row is NonNullable<typeof row> => row !== null),
    findById: async (id: string) =>
      id === "playlist-1"
        ? {
            id,
            name: "Morning",
            description: null,
            createdById: "user-1",
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
          }
        : null,
    create: async () => {
      throw new Error("not used");
    },
    update: async () => null,
    updateStatus: async () => undefined,
    delete: async () => false,
    listItems: async () => [],
    findItemById: async () => null,
    countItemsByContentId: async () => 0,
    addItem: async () => {
      throw new Error("not used");
    },
    updateItem: async () => null,
    reorderItems: async () => true,
    deleteItem: async () => false,
  };

  const displayRepository: DisplayRepository = {
    list: async () => [],
    findByIds: async (ids: string[]) =>
      ids
        .map((id) =>
          id === "display-1"
            ? {
                id,
                name: "Lobby",
                identifier: "AA:BB",
                location: null,
                screenWidth: 1366,
                screenHeight: 768,
                createdAt: "2025-01-01T00:00:00.000Z",
                updatedAt: "2025-01-01T00:00:00.000Z",
              }
            : null,
        )
        .filter((row): row is NonNullable<typeof row> => row !== null),
    findById: async (id: string) =>
      id === "display-1"
        ? {
            id,
            name: "Lobby",
            identifier: "AA:BB",
            location: null,
            screenWidth: 1366,
            screenHeight: 768,
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
          }
        : null,
    findByIdentifier: async () => null,
    findByFingerprint: async () => null,
    create: async () => {
      throw new Error("not used");
    },
    update: async () => null,
    bumpRefreshNonce: async () => false,
  };

  return {
    scheduleRepository,
    playlistRepository,
    displayRepository,
    schedules,
  };
};

describe("Schedules use cases", () => {
  test("ListSchedulesUseCase hydrates schedules with targeted lookups", async () => {
    let playlistListCalls = 0;
    let playlistFindByIdsCalls = 0;
    let displayListCalls = 0;
    let displayFindByIdsCalls = 0;

    const useCase = new ListSchedulesUseCase({
      scheduleRepository: {
        list: async () => [
          {
            id: "schedule-1",
            seriesId: "series-1",
            name: "Morning",
            playlistId: "playlist-1",
            displayId: "display-1",
            startTime: "08:00",
            endTime: "17:00",
            dayOfWeek: 1,
            priority: 10,
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
        update: async () => null,
        delete: async () => false,
        countByPlaylistId: async () => 0,
        listBySeries: async () => [],
        deleteBySeries: async () => 0,
        listByPlaylistId: async () => [],
      },
      playlistRepository: {
        list: async () => {
          playlistListCalls += 1;
          return [];
        },
        listPage: async () => ({ items: [], total: 0 }),
        findByIds: async (ids: string[]) => {
          playlistFindByIdsCalls += 1;
          return ids.includes("playlist-1")
            ? [
                {
                  id: "playlist-1",
                  name: "Morning",
                  description: null,
                  createdById: "user-1",
                  createdAt: "2025-01-01T00:00:00.000Z",
                  updatedAt: "2025-01-01T00:00:00.000Z",
                },
              ]
            : [];
        },
        findById: async () => null,
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        updateStatus: async () => undefined,
        delete: async () => false,
        listItems: async () => [],
        findItemById: async () => null,
        countItemsByContentId: async () => 0,
        addItem: async () => {
          throw new Error("not used");
        },
        updateItem: async () => null,
        reorderItems: async () => true,
        deleteItem: async () => false,
      },
      displayRepository: {
        list: async () => {
          displayListCalls += 1;
          return [];
        },
        findByIds: async (ids: string[]) => {
          displayFindByIdsCalls += 1;
          return ids.includes("display-1")
            ? [
                {
                  id: "display-1",
                  name: "Lobby",
                  identifier: "AA:BB",
                  location: null,
                  createdAt: "2025-01-01T00:00:00.000Z",
                  updatedAt: "2025-01-01T00:00:00.000Z",
                },
              ]
            : [];
        },
        findById: async () => null,
        findByIdentifier: async () => null,
        findByFingerprint: async () => null,
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        bumpRefreshNonce: async () => false,
      },
    });

    const result = await useCase.execute();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.playlist?.id).toBe("playlist-1");
    expect(result.items[0]?.display?.id).toBe("display-1");
    expect(playlistFindByIdsCalls).toBe(1);
    expect(displayFindByIdsCalls).toBe(1);
    expect(playlistListCalls).toBe(0);
    expect(displayListCalls).toBe(0);
  });

  test("CreateScheduleUseCase validates playlist/display", async () => {
    const deps = makeDeps();
    const useCase = new CreateScheduleUseCase({
      scheduleRepository: deps.scheduleRepository,
      playlistRepository: deps.playlistRepository,
      displayRepository: deps.displayRepository,
      contentRepository: {
        create: async () => {
          throw new Error("not used");
        },
        findById: async () => null,
        findByIds: async () => [],
        list: async () => ({ items: [], total: 0 }),
        update: async () => null,
        countPlaylistReferences: async () => 0,
        listPlaylistsReferencingContent: async () => [],
        delete: async () => false,
      },
    });

    await expect(
      useCase.execute({
        name: "Morning",
        playlistId: "missing",
        displayId: "display-1",
        startTime: "08:00",
        endTime: "17:00",
        daysOfWeek: [1, 2, 3],
        priority: 10,
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("CreateScheduleUseCase rejects window shorter than required playback", async () => {
    const deps = makeDeps();
    const useCase = new CreateScheduleUseCase({
      scheduleRepository: deps.scheduleRepository,
      playlistRepository: {
        ...deps.playlistRepository,
        listItems: async () => [
          {
            id: "item-1",
            playlistId: "playlist-1",
            contentId: "content-1",
            sequence: 10,
            duration: 5,
          },
        ],
      },
      displayRepository: deps.displayRepository,
      contentRepository: {
        create: async () => {
          throw new Error("not used");
        },
        findById: async () => null,
        findByIds: async () => [
          {
            id: "content-1",
            title: "Poster",
            type: "IMAGE",
            status: "DRAFT",
            fileKey: "content/images/a.png",
            checksum: "abc",
            mimeType: "image/png",
            fileSize: 100,
            width: 100,
            height: 3000,
            duration: null,
            createdById: "user-1",
            createdAt: "2025-01-01T00:00:00.000Z",
          },
        ],
        list: async () => ({ items: [], total: 0 }),
        update: async () => null,
        countPlaylistReferences: async () => 0,
        listPlaylistsReferencingContent: async () => [],
        delete: async () => false,
      },
    });

    await expect(
      useCase.execute({
        name: "Short Window",
        playlistId: "playlist-1",
        displayId: "display-1",
        startTime: "08:00",
        endTime: "08:01",
        daysOfWeek: [1],
        priority: 1,
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("CreateScheduleUseCase rejects overlapping schedules for the same display", async () => {
    const deps = makeDeps();
    deps.schedules.push({
      id: "schedule-existing",
      seriesId: "series-existing",
      name: "Morning Block",
      playlistId: "playlist-1",
      displayId: "display-1",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      startTime: "10:00",
      endTime: "11:00",
      dayOfWeek: 1,
      priority: 1,
      isActive: true,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    const useCase = new CreateScheduleUseCase({
      scheduleRepository: deps.scheduleRepository,
      playlistRepository: deps.playlistRepository,
      displayRepository: deps.displayRepository,
      contentRepository: {
        create: async () => {
          throw new Error("not used");
        },
        findById: async () => null,
        findByIds: async () => [],
        list: async () => ({ items: [], total: 0 }),
        update: async () => null,
        countPlaylistReferences: async () => 0,
        listPlaylistsReferencingContent: async () => [],
        delete: async () => false,
      },
    });

    await expect(
      useCase.execute({
        name: "Conflict",
        playlistId: "playlist-1",
        displayId: "display-1",
        startDate: "2025-02-01",
        endDate: "2025-11-30",
        startTime: "10:30",
        endTime: "11:30",
        daysOfWeek: [1],
        priority: 1,
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(ScheduleConflictError);
  });

  test("CreateScheduleUseCase allows touching schedule boundaries", async () => {
    const deps = makeDeps();
    deps.schedules.push({
      id: "schedule-existing",
      seriesId: "series-existing",
      name: "Morning Block",
      playlistId: "playlist-1",
      displayId: "display-1",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      startTime: "10:00",
      endTime: "11:00",
      dayOfWeek: 1,
      priority: 1,
      isActive: true,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    const useCase = new CreateScheduleUseCase({
      scheduleRepository: deps.scheduleRepository,
      playlistRepository: deps.playlistRepository,
      displayRepository: deps.displayRepository,
      contentRepository: {
        create: async () => {
          throw new Error("not used");
        },
        findById: async () => null,
        findByIds: async () => [],
        list: async () => ({ items: [], total: 0 }),
        update: async () => null,
        countPlaylistReferences: async () => 0,
        listPlaylistsReferencingContent: async () => [],
        delete: async () => false,
      },
    });

    await expect(
      useCase.execute({
        name: "Back to back",
        playlistId: "playlist-1",
        displayId: "display-1",
        startDate: "2025-02-01",
        endDate: "2025-11-30",
        startTime: "11:00",
        endTime: "12:00",
        daysOfWeek: [1],
        priority: 1,
        isActive: true,
      }),
    ).resolves.toBeDefined();
  });

  test("UpdateScheduleUseCase rejects overlapping schedules", async () => {
    const deps = makeDeps();
    deps.schedules.push(
      {
        id: "schedule-a",
        seriesId: "series-a",
        name: "A",
        playlistId: "playlist-1",
        displayId: "display-1",
        startDate: "2025-01-01",
        endDate: "2025-12-31",
        startTime: "08:00",
        endTime: "09:00",
        dayOfWeek: 1,
        priority: 1,
        isActive: true,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "schedule-b",
        seriesId: "series-b",
        name: "B",
        playlistId: "playlist-1",
        displayId: "display-1",
        startDate: "2025-01-01",
        endDate: "2025-12-31",
        startTime: "10:00",
        endTime: "11:00",
        dayOfWeek: 1,
        priority: 1,
        isActive: true,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    );
    const useCase = new UpdateScheduleUseCase({
      scheduleRepository: deps.scheduleRepository,
      playlistRepository: deps.playlistRepository,
      displayRepository: deps.displayRepository,
      contentRepository: {
        create: async () => {
          throw new Error("not used");
        },
        findById: async () => null,
        findByIds: async () => [],
        list: async () => ({ items: [], total: 0 }),
        update: async () => null,
        countPlaylistReferences: async () => 0,
        listPlaylistsReferencingContent: async () => [],
        delete: async () => false,
      },
    });

    await expect(
      useCase.execute({
        id: "schedule-b",
        startTime: "08:30",
        endTime: "09:30",
      }),
    ).rejects.toBeInstanceOf(ScheduleConflictError);
  });

  test("GetActiveScheduleForDisplayUseCase returns highest priority", async () => {
    const deps = makeDeps();
    deps.schedules.push(
      {
        id: "schedule-1",
        seriesId: "series-1",
        name: "Morning",
        playlistId: "playlist-1",
        displayId: "display-1",
        startTime: "08:00",
        endTime: "12:00",
        dayOfWeek: 1,
        priority: 5,
        isActive: true,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "schedule-2",
        seriesId: "series-2",
        name: "Emergency",
        playlistId: "playlist-1",
        displayId: "display-1",
        startTime: "08:00",
        endTime: "12:00",
        dayOfWeek: 1,
        priority: 10,
        isActive: true,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    );

    const useCase = new GetActiveScheduleForDisplayUseCase({
      scheduleRepository: deps.scheduleRepository,
    });

    const now = new Date("2025-01-06T09:00:00.000Z");
    const result = await useCase.execute({ displayId: "display-1", now });
    expect(result?.id).toBe("schedule-2");
  });

  test("GetActiveScheduleForDisplayUseCase uses configured timezone", async () => {
    const deps = makeDeps();
    deps.schedules.push(
      {
        id: "schedule-manila",
        seriesId: "series-manila",
        name: "Manila Evening",
        playlistId: "playlist-1",
        displayId: "display-1",
        startTime: "17:00",
        endTime: "18:00",
        dayOfWeek: 1,
        priority: 10,
        isActive: true,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "schedule-utc",
        seriesId: "series-utc",
        name: "UTC Morning",
        playlistId: "playlist-1",
        displayId: "display-1",
        startTime: "09:00",
        endTime: "10:00",
        dayOfWeek: 1,
        priority: 5,
        isActive: true,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    );

    const useCase = new GetActiveScheduleForDisplayUseCase({
      scheduleRepository: deps.scheduleRepository,
      scheduleTimeZone: "Asia/Manila",
    });

    const now = new Date("2025-01-06T09:30:00.000Z");
    const result = await useCase.execute({ displayId: "display-1", now });
    expect(result?.id).toBe("schedule-manila");
  });

  test("GetActiveScheduleForDisplayUseCase applies date window in configured timezone", async () => {
    const deps = makeDeps();
    deps.schedules.push(
      {
        id: "local-date",
        seriesId: "series-local",
        name: "Local Date Window",
        playlistId: "playlist-1",
        displayId: "display-1",
        startDate: "2025-01-01",
        endDate: "2025-01-01",
        startTime: "00:00",
        endTime: "23:59",
        dayOfWeek: 3,
        priority: 10,
        isActive: true,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "utc-date",
        seriesId: "series-utc",
        name: "UTC Date Window",
        playlistId: "playlist-1",
        displayId: "display-1",
        startDate: "2024-12-31",
        endDate: "2024-12-31",
        startTime: "00:00",
        endTime: "23:59",
        dayOfWeek: 3,
        priority: 5,
        isActive: true,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    );

    const useCase = new GetActiveScheduleForDisplayUseCase({
      scheduleRepository: deps.scheduleRepository,
      scheduleTimeZone: "Asia/Manila",
    });

    const now = new Date("2024-12-31T16:30:00.000Z");
    const result = await useCase.execute({ displayId: "display-1", now });
    expect(result?.id).toBe("local-date");
  });
});
