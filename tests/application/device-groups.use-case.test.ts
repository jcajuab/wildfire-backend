import { describe, expect, test } from "bun:test";
import {
  type DeviceGroupRecord,
  type DeviceGroupRepository,
  type DeviceRecord,
  type DeviceRepository,
} from "#/application/ports/devices";
import {
  CreateDeviceGroupUseCase,
  DeviceGroupConflictError,
  NotFoundError,
  SetDeviceGroupsUseCase,
  UpdateDeviceGroupUseCase,
} from "#/application/use-cases/devices";

const makeDeviceRepository = (devices: DeviceRecord[]): DeviceRepository => ({
  list: async () => devices,
  findByIds: async (ids: string[]) =>
    devices.filter((device) => ids.includes(device.id)),
  findById: async (id: string) =>
    devices.find((device) => device.id === id) ?? null,
  findByIdentifier: async () => null,
  findByFingerprint: async () => null,
  create: async () => {
    throw new Error("not used");
  },
  update: async () => null,
  bumpRefreshNonce: async () => false,
});

const makeDeviceGroupRepository = (
  initialGroups: DeviceGroupRecord[],
): DeviceGroupRepository & {
  readonly setDeviceGroupsCalls: ReadonlyArray<{
    deviceId: string;
    groupIds: string[];
  }>;
} => {
  const groups = [...initialGroups];
  const setDeviceGroupsCalls: Array<{ deviceId: string; groupIds: string[] }> =
    [];

  return {
    get setDeviceGroupsCalls() {
      return setDeviceGroupsCalls;
    },
    list: async () => [...groups],
    findById: async (id: string) =>
      groups.find((group) => group.id === id) ?? null,
    findByName: async (name: string) =>
      groups.find((group) => group.name === name) ?? null,
    create: async (input: { name: string; colorIndex: number }) => {
      const created: DeviceGroupRecord = {
        id: crypto.randomUUID(),
        name: input.name,
        colorIndex: input.colorIndex,
        deviceIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      };
      groups.push(created);
      return created;
    },
    update: async (
      id: string,
      input: { name?: string; colorIndex?: number },
    ) => {
      const group = groups.find((item) => item.id === id);
      if (!group) return null;
      if (input.name !== undefined) {
        group.name = input.name;
      }
      if (input.colorIndex !== undefined) {
        group.colorIndex = input.colorIndex;
      }
      group.updatedAt = "2025-01-02T00:00:00.000Z";
      return group;
    },
    delete: async () => false,
    setDeviceGroups: async (deviceId: string, groupIds: string[]) => {
      setDeviceGroupsCalls.push({ deviceId, groupIds: [...groupIds] });
    },
  };
};

describe("Device group use cases", () => {
  test("CreateDeviceGroupUseCase returns existing group for case-insensitive duplicate names", async () => {
    const groupRepository = makeDeviceGroupRepository([
      {
        id: "group-1",
        name: "Lobby",
        colorIndex: 2,
        deviceIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    ]);
    const useCase = new CreateDeviceGroupUseCase({
      deviceGroupRepository: groupRepository,
    });

    const result = await useCase.execute({ name: "  lobby " });

    expect(result.id).toBe("group-1");
    expect(result.name).toBe("Lobby");
    expect(result.colorIndex).toBe(2);
  });

  test("CreateDeviceGroupUseCase assigns next cycled color index when omitted", async () => {
    const groupRepository = makeDeviceGroupRepository([
      {
        id: "group-1",
        name: "Lobby",
        colorIndex: 10,
        deviceIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "group-2",
        name: "Office",
        colorIndex: 11,
        deviceIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    ]);
    const useCase = new CreateDeviceGroupUseCase({
      deviceGroupRepository: groupRepository,
    });

    const created = await useCase.execute({ name: "Cafeteria" });

    expect(created.colorIndex).toBe(0);
  });

  test("UpdateDeviceGroupUseCase rejects case-insensitive rename conflicts", async () => {
    const groupRepository = makeDeviceGroupRepository([
      {
        id: "group-1",
        name: "Lobby",
        colorIndex: 0,
        deviceIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "group-2",
        name: "Office",
        colorIndex: 1,
        deviceIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    ]);
    const useCase = new UpdateDeviceGroupUseCase({
      deviceGroupRepository: groupRepository,
    });

    await expect(
      useCase.execute({ id: "group-2", name: "  LOBBY  " }),
    ).rejects.toBeInstanceOf(DeviceGroupConflictError);
  });

  test("SetDeviceGroupsUseCase deduplicates group ids before writing", async () => {
    const groupRepository = makeDeviceGroupRepository([
      {
        id: "group-1",
        name: "Lobby",
        colorIndex: 0,
        deviceIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "group-2",
        name: "Office",
        colorIndex: 1,
        deviceIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    ]);
    const deviceRepository = makeDeviceRepository([
      {
        id: "device-1",
        name: "Lobby Display",
        identifier: "AA:BB",
        location: null,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    ]);
    const useCase = new SetDeviceGroupsUseCase({
      deviceRepository,
      deviceGroupRepository: groupRepository,
    });

    await useCase.execute({
      deviceId: "device-1",
      groupIds: ["group-1", "group-1", "group-2", "group-1"],
    });

    expect(groupRepository.setDeviceGroupsCalls).toEqual([
      {
        deviceId: "device-1",
        groupIds: ["group-1", "group-2"],
      },
    ]);
  });

  test("SetDeviceGroupsUseCase throws when device does not exist", async () => {
    const groupRepository = makeDeviceGroupRepository([]);
    const useCase = new SetDeviceGroupsUseCase({
      deviceRepository: makeDeviceRepository([]),
      deviceGroupRepository: groupRepository,
    });

    await expect(
      useCase.execute({ deviceId: "missing", groupIds: [] }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
