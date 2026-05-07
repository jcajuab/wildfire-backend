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
  ResolveDisplayGroupsUseCase,
  SearchDisplayGroupsUseCase,
  SetDisplayGroupsUseCase,
  UpdateDisplayGroupUseCase,
} from "#/application/use-cases/displays";

const makeDisplayRepository = (
  displays: DisplayRecord[],
): DisplayRepository => ({
  list: async () => displays,
  listForReconciliation: async () => displays,
  listPage: async ({ offset, limit }) => ({
    items: displays.slice(offset, offset + limit),
    total: displays.length,
  }),
  findByIds: async (ids: string[]) =>
    displays.filter((display) => ids.includes(display.id)),
  findById: async (id: string) =>
    displays.find((display) => display.id === id) ?? null,
  findBySlug: async (slug: string) =>
    displays.find((display) => display.slug === slug) ?? null,
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
  searchPage: async () => ({ items: [], total: 0 }),
  delete: async (_id: string) => false,
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
    listPage: async (input: {
      offset: number;
      limit: number;
      q?: string;
      displayId?: string;
      membership?: "member" | "non-member";
    }) => {
      const normalizedQuery = input.q?.trim().toLowerCase();
      const filtered = groups.filter((group) => {
        if (
          normalizedQuery &&
          !group.name.toLowerCase().includes(normalizedQuery)
        ) {
          return false;
        }
        if (input.displayId) {
          const isMember = group.displayIds.includes(input.displayId);
          if (input.membership === "non-member") {
            if (isMember) return false;
          } else if (!isMember) {
            return false;
          }
        }
        return true;
      });
      const sorted = [...filtered].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      return {
        items: sorted.slice(input.offset, input.offset + input.limit),
        total: sorted.length,
      };
    },
    findById: async (id: string) =>
      groups.find((group) => group.id === id) ?? null,
    findByName: async (name: string) =>
      groups.find((group) => group.name === name) ?? null,
    create: async (input: { name: string }) => {
      const created: DisplayGroupRecord = {
        id: crypto.randomUUID(),
        name: input.name,
        displayIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      };
      groups.push(created);
      return created;
    },
    update: async (id: string, input: { name?: string }) => {
      const group = groups.find((item) => item.id === id);
      if (!group) return null;
      if (input.name !== undefined) {
        group.name = input.name;
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
  });

  test("CreateDisplayGroupUseCase creates a new group with the given name", async () => {
    const groupRepository = makeDisplayGroupRepository([]);
    const useCase = new CreateDisplayGroupUseCase({
      displayGroupRepository: groupRepository,
    });

    const created = await useCase.execute({ name: "Cafeteria" });

    expect(created.name).toBe("Cafeteria");
  });

  test("UpdateDisplayGroupUseCase rejects case-insensitive rename conflicts", async () => {
    const groupRepository = makeDisplayGroupRepository([
      {
        id: "group-1",
        name: "Lobby",
        displayIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "group-2",
        name: "Office",
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
        displayIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "group-2",
        name: "Office",
        displayIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    ]);
    const displayRepository = makeDisplayRepository([
      {
        id: "display-1",
        name: "Lobby Display",
        slug: "display-1",
        status: "READY",
        output: "hdmi-0",
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

  test("SearchDisplayGroupsUseCase paginates results", async () => {
    const groupRepository = makeDisplayGroupRepository(
      Array.from({ length: 7 }, (_, index) => ({
        id: `group-${index}`,
        name: `Group ${String.fromCharCode(65 + index)}`,
        displayIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      })),
    );
    const useCase = new SearchDisplayGroupsUseCase({
      displayGroupRepository: groupRepository,
    });

    const page1 = await useCase.execute({ page: 1, pageSize: 5 });
    expect(page1.items).toHaveLength(5);
    expect(page1.total).toBe(7);
    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(5);
    expect(page1.items.map((group) => group.name)).toEqual([
      "Group A",
      "Group B",
      "Group C",
      "Group D",
      "Group E",
    ]);

    const page2 = await useCase.execute({ page: 2, pageSize: 5 });
    expect(page2.items).toHaveLength(2);
    expect(page2.total).toBe(7);
    expect(page2.items.map((group) => group.name)).toEqual([
      "Group F",
      "Group G",
    ]);
  });

  test("SearchDisplayGroupsUseCase filters by case-insensitive q", async () => {
    const groupRepository = makeDisplayGroupRepository([
      {
        id: "group-1",
        name: "Lobby",
        displayIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "group-2",
        name: "Cafeteria",
        displayIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    ]);
    const useCase = new SearchDisplayGroupsUseCase({
      displayGroupRepository: groupRepository,
    });

    const result = await useCase.execute({ q: "lob" });
    expect(result.items.map((group) => group.name)).toEqual(["Lobby"]);
    expect(result.total).toBe(1);
  });

  test("SearchDisplayGroupsUseCase filters by displayId+member", async () => {
    const groupRepository = makeDisplayGroupRepository([
      {
        id: "group-1",
        name: "Lobby",
        displayIds: ["display-1"],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "group-2",
        name: "Cafeteria",
        displayIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    ]);
    const useCase = new SearchDisplayGroupsUseCase({
      displayGroupRepository: groupRepository,
    });

    const members = await useCase.execute({
      displayId: "display-1",
      membership: "member",
    });
    expect(members.items.map((group) => group.id)).toEqual(["group-1"]);
  });

  test("SearchDisplayGroupsUseCase filters by displayId+non-member", async () => {
    const groupRepository = makeDisplayGroupRepository([
      {
        id: "group-1",
        name: "Lobby",
        displayIds: ["display-1"],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "group-2",
        name: "Cafeteria",
        displayIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    ]);
    const useCase = new SearchDisplayGroupsUseCase({
      displayGroupRepository: groupRepository,
    });

    const nonMembers = await useCase.execute({
      displayId: "display-1",
      membership: "non-member",
    });
    expect(nonMembers.items.map((group) => group.id)).toEqual(["group-2"]);
  });

  test("ResolveDisplayGroupsUseCase returns existing IDs and creates missing ones", async () => {
    const groupRepository = makeDisplayGroupRepository([
      {
        id: "group-existing",
        name: "Lobby",
        displayIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    ]);
    const useCase = new ResolveDisplayGroupsUseCase({
      displayGroupRepository: groupRepository,
    });

    const result = await useCase.execute({
      names: ["  lobby ", "Cafeteria", "Lobby"],
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({ id: "group-existing", name: "Lobby" });
    expect(result.items[1]?.name).toBe("Cafeteria");
    expect(result.items[1]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  test("SearchDisplayGroupsUseCase passes sortBy=count and sortDirection=desc to repository", async () => {
    const listPageInputs: Array<{
      offset: number;
      limit: number;
      sortBy?: string;
      sortDirection?: string;
    }> = [];

    // Use the existing makeDisplayGroupRepository but capture listPage inputs
    const baseRepo = makeDisplayGroupRepository([
      {
        id: "group-1",
        name: "Alpha",
        displayIds: ["d1", "d2", "d3"],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "group-2",
        name: "Beta",
        displayIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    ]);
    const wrappedRepo = {
      ...baseRepo,
      listPage: async (input: Parameters<typeof baseRepo.listPage>[0]) => {
        listPageInputs.push(input);
        return baseRepo.listPage(input);
      },
    };

    const useCase = new SearchDisplayGroupsUseCase({
      displayGroupRepository: wrappedRepo,
    });

    await useCase.execute({ sortBy: "count", sortDirection: "desc" });

    expect(listPageInputs).toHaveLength(1);
    expect(listPageInputs[0]?.sortBy).toBe("count");
    expect(listPageInputs[0]?.sortDirection).toBe("desc");
  });

  test("ResolveDisplayGroupsUseCase rejects empty names", async () => {
    const groupRepository = makeDisplayGroupRepository([]);
    const useCase = new ResolveDisplayGroupsUseCase({
      displayGroupRepository: groupRepository,
    });

    await expect(useCase.execute({ names: ["   "] })).rejects.toThrow();
  });
});
