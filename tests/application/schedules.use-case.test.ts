import { describe, expect, test } from "bun:test";
import { type DeviceRepository } from "#/application/ports/devices";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  CreateScheduleUseCase,
  GetActiveScheduleForDeviceUseCase,
  ListSchedulesUseCase,
  NotFoundError,
} from "#/application/use-cases/schedules";

const makeDeps = () => {
  const schedules = [] as Array<{
    id: string;
    name: string;
    playlistId: string;
    deviceId: string;
    startTime: string;
    endTime: string;
    daysOfWeek: number[];
    priority: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  }>;

  const scheduleRepository: ScheduleRepository = {
    list: async () => [...schedules],
    listByDevice: async (deviceId: string) =>
      schedules.filter((schedule) => schedule.deviceId === deviceId),
    findById: async () => null,
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
    update: async () => null,
    delete: async () => false,
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
    deleteItem: async () => false,
  };

  const deviceRepository: DeviceRepository = {
    list: async () => [],
    findByIds: async (ids: string[]) =>
      ids
        .map((id) =>
          id === "device-1"
            ? {
                id,
                name: "Lobby",
                identifier: "AA:BB",
                location: null,
                createdAt: "2025-01-01T00:00:00.000Z",
                updatedAt: "2025-01-01T00:00:00.000Z",
              }
            : null,
        )
        .filter((row): row is NonNullable<typeof row> => row !== null),
    findById: async (id: string) =>
      id === "device-1"
        ? {
            id,
            name: "Lobby",
            identifier: "AA:BB",
            location: null,
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
          }
        : null,
    findByIdentifier: async () => null,
    create: async () => {
      throw new Error("not used");
    },
    update: async () => null,
  };

  return {
    scheduleRepository,
    playlistRepository,
    deviceRepository,
    schedules,
  };
};

describe("Schedules use cases", () => {
  test("ListSchedulesUseCase hydrates schedules with targeted lookups", async () => {
    let playlistListCalls = 0;
    let playlistFindByIdsCalls = 0;
    let deviceListCalls = 0;
    let deviceFindByIdsCalls = 0;

    const useCase = new ListSchedulesUseCase({
      scheduleRepository: {
        list: async () => [
          {
            id: "schedule-1",
            name: "Morning",
            playlistId: "playlist-1",
            deviceId: "device-1",
            startTime: "08:00",
            endTime: "17:00",
            daysOfWeek: [1, 2, 3],
            priority: 10,
            isActive: true,
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
          },
        ],
        listByDevice: async () => [],
        findById: async () => null,
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        delete: async () => false,
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
        deleteItem: async () => false,
      },
      deviceRepository: {
        list: async () => {
          deviceListCalls += 1;
          return [];
        },
        findByIds: async (ids: string[]) => {
          deviceFindByIdsCalls += 1;
          return ids.includes("device-1")
            ? [
                {
                  id: "device-1",
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
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
      },
    });

    const result = await useCase.execute();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.playlist?.id).toBe("playlist-1");
    expect(result.items[0]?.device?.id).toBe("device-1");
    expect(playlistFindByIdsCalls).toBe(1);
    expect(deviceFindByIdsCalls).toBe(1);
    expect(playlistListCalls).toBe(0);
    expect(deviceListCalls).toBe(0);
  });

  test("CreateScheduleUseCase validates playlist/device", async () => {
    const deps = makeDeps();
    const useCase = new CreateScheduleUseCase({
      scheduleRepository: deps.scheduleRepository,
      playlistRepository: deps.playlistRepository,
      deviceRepository: deps.deviceRepository,
    });

    await expect(
      useCase.execute({
        name: "Morning",
        playlistId: "missing",
        deviceId: "device-1",
        startTime: "08:00",
        endTime: "17:00",
        daysOfWeek: [1, 2, 3],
        priority: 10,
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("GetActiveScheduleForDeviceUseCase returns highest priority", async () => {
    const deps = makeDeps();
    deps.schedules.push(
      {
        id: "schedule-1",
        name: "Morning",
        playlistId: "playlist-1",
        deviceId: "device-1",
        startTime: "08:00",
        endTime: "12:00",
        daysOfWeek: [1],
        priority: 5,
        isActive: true,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "schedule-2",
        name: "Emergency",
        playlistId: "playlist-1",
        deviceId: "device-1",
        startTime: "08:00",
        endTime: "12:00",
        daysOfWeek: [1],
        priority: 10,
        isActive: true,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    );

    const useCase = new GetActiveScheduleForDeviceUseCase({
      scheduleRepository: deps.scheduleRepository,
    });

    const now = new Date("2025-01-06T09:00:00.000Z");
    const result = await useCase.execute({ deviceId: "device-1", now });
    expect(result?.id).toBe("schedule-2");
  });

  test("GetActiveScheduleForDeviceUseCase uses configured timezone", async () => {
    const deps = makeDeps();
    deps.schedules.push(
      {
        id: "schedule-manila",
        name: "Manila Evening",
        playlistId: "playlist-1",
        deviceId: "device-1",
        startTime: "17:00",
        endTime: "18:00",
        daysOfWeek: [1],
        priority: 10,
        isActive: true,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "schedule-utc",
        name: "UTC Morning",
        playlistId: "playlist-1",
        deviceId: "device-1",
        startTime: "09:00",
        endTime: "10:00",
        daysOfWeek: [1],
        priority: 5,
        isActive: true,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    );

    const useCase = new GetActiveScheduleForDeviceUseCase({
      scheduleRepository: deps.scheduleRepository,
      scheduleTimeZone: "Asia/Manila",
    });

    const now = new Date("2025-01-06T09:30:00.000Z");
    const result = await useCase.execute({ deviceId: "device-1", now });
    expect(result?.id).toBe("schedule-manila");
  });
});
