import { describe, expect, test } from "bun:test";
import {
  type DisplayGroupRecord,
  type DisplayGroupRepository,
  type DisplayRecord,
  type DisplayRepository,
} from "#/application/ports/displays";
import {
  CreateDisplayGroupUseCase,
  DisplayGroupConflictError,
  NotFoundError,
  SetDisplayGroupsUseCase,
  UpdateDisplayGroupUseCase,
} from "#/application/use-cases/displays";

const makeDisplayRepository = (
  displays: DisplayRecord[],
): DisplayRepository => ({
  list: async () => displays,
  findByIds: async (ids: string[]) =>
    displays.filter((display) => ids.includes(display.id)),
  findById: async (id: string) =>
    displays.find((display) => display.id === id) ?? null,
  findByIdentifier: async () => null,
  findByFingerprint: async () => null,
  create: async () => {
    throw new Error("not used");
  },
  update: async () => null,
  bumpRefreshNonce: async () => false,
});

const makeDisplayGroupRepository = (
  initialGroups: DisplayGroupRecord[],
): DisplayGroupRepository & {
  readonly setDisplayGroupsCalls: ReadonlyArray<{
    displayId: string;
    groupIds: string[];
  }>;
} => {
  const groups = [...initialGroups];
  const setDisplayGroupsCalls: Array<{
    displayId: string;
    groupIds: string[];
  }> = [];

  return {
    get setDisplayGroupsCalls() {
      return setDisplayGroupsCalls;
    },
    list: async () => [...groups],
    findById: async (id: string) =>
      groups.find((group) => group.id === id) ?? null,
    findByName: async (name: string) =>
      groups.find((group) => group.name === name) ?? null,
    create: async (input: { name: string; colorIndex: number }) => {
      const created: DisplayGroupRecord = {
        id: crypto.randomUUID(),
        name: input.name,
        colorIndex: input.colorIndex,
        displayIds: [],
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
    setDisplayGroups: async (displayId: string, groupIds: string[]) => {
      setDisplayGroupsCalls.push({ displayId, groupIds: [...groupIds] });
    },
  };
};

describe("Display group use cases", () => {
  test("CreateDisplayGroupUseCase returns existing group for case-insensitive duplicate names", async () => {
    const groupRepository = makeDisplayGroupRepository([
      {
        id: "group-1",
        name: "Lobby",
        colorIndex: 2,
        displayIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    ]);
    const useCase = new CreateDisplayGroupUseCase({
      displayGroupRepository: groupRepository,
    });

    const result = await useCase.execute({ name: "  lobby " });

    expect(result.id).toBe("group-1");
    expect(result.name).toBe("Lobby");
    expect(result.colorIndex).toBe(2);
  });

  test("CreateDisplayGroupUseCase assigns next cycled color index when omitted", async () => {
    const groupRepository = makeDisplayGroupRepository([
      {
        id: "group-1",
        name: "Lobby",
        colorIndex: 10,
        displayIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "group-2",
        name: "Office",
        colorIndex: 11,
        displayIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    ]);
    const useCase = new CreateDisplayGroupUseCase({
      displayGroupRepository: groupRepository,
    });

    const created = await useCase.execute({ name: "Cafeteria" });

    expect(created.colorIndex).toBe(0);
  });

  test("UpdateDisplayGroupUseCase rejects case-insensitive rename conflicts", async () => {
    const groupRepository = makeDisplayGroupRepository([
      {
        id: "group-1",
        name: "Lobby",
        colorIndex: 0,
        displayIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "group-2",
        name: "Office",
        colorIndex: 1,
        displayIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    ]);
    const useCase = new UpdateDisplayGroupUseCase({
      displayGroupRepository: groupRepository,
    });

    await expect(
      useCase.execute({ id: "group-2", name: "  LOBBY  " }),
    ).rejects.toBeInstanceOf(DisplayGroupConflictError);
  });

  test("SetDisplayGroupsUseCase deduplicates group ids before writing", async () => {
    const groupRepository = makeDisplayGroupRepository([
      {
        id: "group-1",
        name: "Lobby",
        colorIndex: 0,
        displayIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "group-2",
        name: "Office",
        colorIndex: 1,
        displayIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    ]);
    const displayRepository = makeDisplayRepository([
      {
        id: "display-1",
        name: "Lobby Display",
        identifier: "AA:BB",
        location: null,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    ]);
    const useCase = new SetDisplayGroupsUseCase({
      displayRepository,
      displayGroupRepository: groupRepository,
    });

    await useCase.execute({
      displayId: "display-1",
      groupIds: ["group-1", "group-1", "group-2", "group-1"],
    });

    expect(groupRepository.setDisplayGroupsCalls).toEqual([
      {
        displayId: "display-1",
        groupIds: ["group-1", "group-2"],
      },
    ]);
  });

  test("SetDisplayGroupsUseCase throws when display does not exist", async () => {
    const groupRepository = makeDisplayGroupRepository([]);
    const useCase = new SetDisplayGroupsUseCase({
      displayRepository: makeDisplayRepository([]),
      displayGroupRepository: groupRepository,
    });

    await expect(
      useCase.execute({ displayId: "missing", groupIds: [] }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
