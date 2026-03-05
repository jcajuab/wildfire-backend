import { describe, expect, test } from "bun:test";
import {
  type DisplayRecord,
  type DisplayRepository,
} from "#/application/ports/displays";
import {
  GetDisplayManifestUseCase,
  GetDisplayUseCase,
  ListDisplaysUseCase,
  NotFoundError,
  RequestDisplayRefreshUseCase,
  UpdateDisplayUseCase,
} from "#/application/use-cases/displays";

const makeRepository = () => {
  const records: DisplayRecord[] = [];

  const repo: DisplayRepository = {
    list: async () => [...records],
    listPage: async (input: { page: number; pageSize: number }) => {
      const page = Math.max(1, input.page);
      const pageSize = Math.max(1, input.pageSize);
      const offset = (page - 1) * pageSize;
      return {
        items: records.slice(offset, offset + pageSize),
        total: records.length,
        page,
        pageSize,
      };
    },
    findByIds: async (ids: string[]) =>
      ids
        .map((id) => records.find((record) => record.id === id) ?? null)
        .filter((record): record is DisplayRecord => record !== null),
    findById: async (id: string) =>
      records.find((record) => record.id === id) ?? null,
    findByIdentifier: async (identifier: string) =>
      records.find((record) => record.identifier === identifier) ?? null,
    findBySlug: async (displaySlug: string) =>
      records.find((record) => record.displaySlug === displaySlug) ?? null,
    findByFingerprint: async (fingerprint: string) =>
      records.find((record) => record.displayFingerprint === fingerprint) ??
      null,
    findByFingerprintAndOutput: async (
      fingerprint: string,
      displayOutput: string,
    ) =>
      records.find(
        (record) =>
          record.displayFingerprint === fingerprint &&
          (record.displayOutput ?? null) === displayOutput,
      ) ?? null,
    create: async (input) => {
      const record: DisplayRecord = {
        id: `display-${records.length + 1}`,
        displaySlug: input.identifier
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-"),
        name: input.name,
        identifier: input.identifier,
        displayFingerprint: input.displayFingerprint ?? null,
        status: "PROCESSING",
        location: input.location,
        screenWidth: null,
        screenHeight: null,
        outputType: null,
        orientation: null,
        lastSeenAt: null,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      };
      records.push(record);
      return record;
    },
    createRegisteredDisplay: async (input) => {
      const record: DisplayRecord = {
        id: `display-${records.length + 1}`,
        displaySlug: input.displaySlug,
        name: input.name,
        identifier: input.displaySlug,
        displayFingerprint: input.displayFingerprint,
        status: "PROCESSING",
        location: null,
        screenWidth: input.screenWidth,
        screenHeight: input.screenHeight,
        outputType: input.displayOutput,
        displayOutput: input.displayOutput,
        orientation: input.orientation ?? null,
        lastSeenAt: null,
        createdAt: input.now.toISOString(),
        updatedAt: input.now.toISOString(),
      };
      records.push(record);
      return record;
    },
    update: async (id, input) => {
      const record = records.find((item) => item.id === id);
      if (!record) return null;
      if (input.name !== undefined) record.name = input.name;
      if (input.identifier !== undefined) record.identifier = input.identifier;
      if (input.displayFingerprint !== undefined)
        record.displayFingerprint = input.displayFingerprint;
      if (input.location !== undefined) record.location = input.location;
      if (input.screenWidth !== undefined)
        record.screenWidth = input.screenWidth;
      if (input.screenHeight !== undefined)
        record.screenHeight = input.screenHeight;
      if (input.outputType !== undefined) record.outputType = input.outputType;
      if (input.orientation !== undefined)
        record.orientation = input.orientation;
      record.updatedAt = "2025-01-02T00:00:00.000Z";
      return record;
    },
    setStatus: async ({ id, status, at }) => {
      const record = records.find((item) => item.id === id);
      if (!record) return;
      record.status = status;
      record.updatedAt = at.toISOString();
    },
    bumpRefreshNonce: async (id: string) => {
      const record = records.find((item) => item.id === id);
      if (!record) return false;
      record.refreshNonce = (record.refreshNonce ?? 0) + 1;
      return true;
    },
    touchSeen: async (id: string, at: Date) => {
      const record = records.find((item) => item.id === id);
      if (!record) return;
      record.lastSeenAt = at.toISOString();
      record.updatedAt = at.toISOString();
    },
    delete: async (_id: string) => false,
  };

  return { repo, records };
};

describe("Displays use cases", () => {
  test("ListDisplaysUseCase returns displays", async () => {
    const { repo } = makeRepository();
    const listDisplays = new ListDisplaysUseCase({
      displayRepository: repo,
      scheduleRepository: {
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
      },
      playlistRepository: {
        list: async () => [],
        listPage: async () => ({ items: [], total: 0 }),
        findByIds: async () => [],
        findById: async () => null,
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        updateStatus: async () => undefined,
        delete: async () => false,
        listItems: async () => [
          {
            id: "item-live",
            playlistId: "playlist-live",
            contentId: "content-live",
            sequence: 10,
            duration: 15,
          },
        ],
        findItemById: async () => null,
        countItemsByContentId: async () => 0,
        addItem: async () => {
          throw new Error("not used");
        },
        updateItem: async () => null,
        reorderItems: async () => true,
        deleteItem: async () => false,
      },
    });

    await repo.create({
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
    });

    const result = await listDisplays.execute();
    expect(result.items).toHaveLength(1);
  });

  test("ListDisplaysUseCase returns persisted display statuses", async () => {
    const { repo, records } = makeRepository();
    const listDisplays = new ListDisplaysUseCase({
      displayRepository: repo,
      scheduleRepository: {
        list: async () => [
          {
            id: "schedule-live",
            name: "Always on",
            playlistId: "playlist-live",
            displayId: "display-2",
            startTime: "00:00",
            endTime: "23:59",
            priority: 100,
            isActive: true,
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
          },
        ],
        listByDisplay: async () => [],
        listByPlaylistId: async () => [],
        findById: async () => null,
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        delete: async () => false,
        countByPlaylistId: async () => 0,
      },
      playlistRepository: {
        list: async () => [],
        listPage: async () => ({ items: [], total: 0 }),
        findByIds: async (ids: string[]) =>
          ids.includes("playlist-live")
            ? [
                {
                  id: "playlist-live",
                  name: "Live Playlist",
                  description: null,
                  createdById: "user-1",
                  createdAt: "2025-01-01T00:00:00.000Z",
                  updatedAt: "2025-01-01T00:00:00.000Z",
                },
              ]
            : [],
        findById: async () => null,
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        updateStatus: async () => undefined,
        delete: async () => false,
        listItems: async () => [
          {
            id: "item-live",
            playlistId: "playlist-live",
            contentId: "content-live",
            sequence: 10,
            duration: 15,
          },
        ],
        findItemById: async () => null,
        countItemsByContentId: async () => 0,
        addItem: async () => {
          throw new Error("not used");
        },
        updateItem: async () => null,
        reorderItems: async () => true,
        deleteItem: async () => false,
      },
    });

    await repo.create({
      name: "Never seen",
      identifier: "AA:BB:CC:00:00:01",
      location: null,
    });
    await repo.create({
      name: "Recently seen",
      identifier: "AA:BB:CC:00:00:02",
      location: null,
    });
    await repo.create({
      name: "Stale heartbeat",
      identifier: "AA:BB:CC:00:00:03",
      location: null,
    });
    await repo.create({
      name: "Ready display",
      identifier: "AA:BB:CC:00:00:04",
      location: null,
    });

    const neverSeen = records.find((record) => record.name === "Never seen");
    const recentlySeen = records.find(
      (record) => record.name === "Recently seen",
    );
    const staleHeartbeat = records.find(
      (record) => record.name === "Stale heartbeat",
    );
    const readyDisplay = records.find(
      (record) => record.name === "Ready display",
    );

    if (!neverSeen || !recentlySeen || !staleHeartbeat || !readyDisplay) {
      throw new Error("Expected seeded display records to exist");
    }

    neverSeen.status = "PROCESSING";
    recentlySeen.status = "LIVE";
    staleHeartbeat.status = "DOWN";
    readyDisplay.status = "READY";

    const result = await listDisplays.execute();
    const statusByIdentifier = new Map(
      result.items.map((item) => [item.identifier, item.status]),
    );
    const nowPlayingByIdentifier = new Map(
      result.items.map((item) => [item.identifier, item.nowPlaying]),
    );

    expect(statusByIdentifier.get(neverSeen.identifier)).toBe("PROCESSING");
    expect(statusByIdentifier.get(recentlySeen.identifier)).toBe("LIVE");
    expect(statusByIdentifier.get(staleHeartbeat.identifier)).toBe("DOWN");
    expect(statusByIdentifier.get(readyDisplay.identifier)).toBe("READY");
    expect(nowPlayingByIdentifier.get(recentlySeen.identifier)).toEqual({
      title: null,
      playlist: "Live Playlist",
      progress: 0,
      duration: 0,
    });
    expect(nowPlayingByIdentifier.get(neverSeen.identifier)).toBeNull();
  });

  test("GetDisplayUseCase throws when missing", async () => {
    const { repo } = makeRepository();
    const getDisplay = new GetDisplayUseCase({
      displayRepository: repo,
      scheduleRepository: {
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
      },
      playlistRepository: {
        list: async () => [],
        listPage: async () => ({ items: [], total: 0 }),
        findByIds: async () => [],
        findById: async () => ({
          id: "playlist-live",
          name: "Live Playlist",
          description: null,
          createdById: "user-1",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }),
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        updateStatus: async () => undefined,
        delete: async () => false,
        listItems: async () => [
          {
            id: "item-live",
            playlistId: "playlist-live",
            contentId: "content-live",
            sequence: 10,
            duration: 15,
          },
        ],
        findItemById: async () => null,
        countItemsByContentId: async () => 0,
        addItem: async () => {
          throw new Error("not used");
        },
        updateItem: async () => null,
        reorderItems: async () => true,
        deleteItem: async () => false,
      },
    });

    await expect(getDisplay.execute({ id: "missing" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("UpdateDisplayUseCase updates mutable display fields", async () => {
    const { repo } = makeRepository();
    const created = await repo.create({
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
    });

    const updateDisplay = new UpdateDisplayUseCase({
      displayRepository: repo,
      scheduleRepository: {
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
      },
    });
    const updated = await updateDisplay.execute({
      id: created.id,
      name: "Lobby TV",
      location: "Main Hall",
      screenWidth: 1920,
      screenHeight: 1080,
      outputType: "HDMI-0",
      orientation: "LANDSCAPE",
    });

    expect(updated.name).toBe("Lobby TV");
    expect(updated.location).toBe("Main Hall");
    expect(updated.screenWidth).toBe(1920);
    expect(updated.screenHeight).toBe(1080);
    expect(updated.outputType).toBe("HDMI-0");
    expect(updated.orientation).toBe("LANDSCAPE");
  });

  test("RequestDisplayRefreshUseCase increments refresh nonce", async () => {
    const { repo } = makeRepository();
    const created = await repo.create({
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
    });

    const useCase = new RequestDisplayRefreshUseCase({
      displayRepository: repo,
    });

    await useCase.execute({ id: created.id });

    const refreshed = await repo.findById(created.id);
    expect(refreshed?.refreshNonce).toBe(1);
  });

  test("GetDisplayManifestUseCase returns empty when no schedule", async () => {
    const { repo } = makeRepository();
    const created = await repo.create({
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
    });

    const useCase = new GetDisplayManifestUseCase({
      scheduleRepository: {
        listByDisplay: async () => [],
        list: async () => [],
        findById: async () => null,
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        delete: async () => false,
        countByPlaylistId: async () => 0,
        listByPlaylistId: async () => [],
      },
      playlistRepository: {
        list: async () => [],
        listPage: async () => ({ items: [], total: 0 }),
        findByIds: async () => [],
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
      contentRepository: {
        findById: async () => null,
        findByIds: async () => [],
        create: async () => {
          throw new Error("not used");
        },
        list: async () => ({ items: [], total: 0 }),
        countPlaylistReferences: async () => 0,
        listPlaylistsReferencingContent: async () => [],
        delete: async () => false,
        update: async () => null,
      },
      contentStorage: {
        ensureBucketExists: async () => {},
        upload: async () => {},
        delete: async () => {},
        getPresignedDownloadUrl: async () => "",
      },
      displayRepository: repo,
      downloadUrlExpiresInSeconds: 3600,
    });

    const result = await useCase.execute({
      displayId: created.id,
      now: new Date("2025-01-01T00:00:00.000Z"),
    });

    expect(result.items).toHaveLength(0);
    expect(result.playlistId).toBeNull();
    expect(result.runtimeSettings.scrollPxPerSecond).toBe(24);
  });

  test("GetDisplayManifestUseCase uses default runtime scroll setting", async () => {
    const { repo } = makeRepository();
    const created = await repo.create({
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
    });

    const useCase = new GetDisplayManifestUseCase({
      scheduleRepository: {
        listByDisplay: async () => [],
        list: async () => [],
        findById: async () => null,
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        delete: async () => false,
        countByPlaylistId: async () => 0,
        listByPlaylistId: async () => [],
      },
      playlistRepository: {
        list: async () => [],
        listPage: async () => ({ items: [], total: 0 }),
        findByIds: async () => [],
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
      contentRepository: {
        findById: async () => null,
        findByIds: async () => [],
        create: async () => {
          throw new Error("not used");
        },
        list: async () => ({ items: [], total: 0 }),
        countPlaylistReferences: async () => 0,
        listPlaylistsReferencingContent: async () => [],
        delete: async () => false,
        update: async () => null,
      },
      contentStorage: {
        ensureBucketExists: async () => {},
        upload: async () => {},
        delete: async () => {},
        getPresignedDownloadUrl: async () => "",
      },
      displayRepository: repo,
      downloadUrlExpiresInSeconds: 3600,
    });

    const result = await useCase.execute({
      displayId: created.id,
      now: new Date("2025-01-01T00:00:00.000Z"),
    });
    expect(result.runtimeSettings.scrollPxPerSecond).toBe(24);
  });

  test("GetDisplayManifestUseCase version changes after refresh request", async () => {
    const { repo } = makeRepository();
    const created = await repo.create({
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
    });

    const manifestUseCase = new GetDisplayManifestUseCase({
      scheduleRepository: {
        listByDisplay: async () => [
          {
            id: "schedule-1",
            name: "Morning",
            playlistId: "playlist-1",
            displayId: created.id,
            startTime: "00:00",
            endTime: "23:59",
            priority: 10,
            isActive: true,
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
          },
        ],
        list: async () => [],
        findById: async () => null,
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        delete: async () => false,
        countByPlaylistId: async () => 0,
        listByPlaylistId: async () => [],
      },
      playlistRepository: {
        list: async () => [],
        listPage: async () => ({ items: [], total: 0 }),
        findByIds: async () => [],
        findById: async () => ({
          id: "playlist-1",
          name: "Morning",
          description: null,
          createdById: "user-1",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }),
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        updateStatus: async () => undefined,
        delete: async () => false,
        listItems: async () => [
          {
            id: "item-1",
            playlistId: "playlist-1",
            contentId: "content-1",
            sequence: 10,
            duration: 5,
          },
        ],
        findItemById: async () => null,
        countItemsByContentId: async () => 0,
        addItem: async () => {
          throw new Error("not used");
        },
        updateItem: async () => null,
        reorderItems: async () => true,
        deleteItem: async () => false,
      },
      contentRepository: {
        findById: async () => null,
        findByIds: async () => [
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
            createdById: "user-1",
            createdAt: "2025-01-01T00:00:00.000Z",
          },
        ],
        create: async () => {
          throw new Error("not used");
        },
        list: async () => ({ items: [], total: 0 }),
        countPlaylistReferences: async () => 0,
        listPlaylistsReferencingContent: async () => [],
        delete: async () => false,
        update: async () => null,
      },
      contentStorage: {
        ensureBucketExists: async () => {},
        upload: async () => {},
        delete: async () => {},
        getPresignedDownloadUrl: async () => "https://example.com/file",
      },
      displayRepository: repo,
      downloadUrlExpiresInSeconds: 3600,
    });

    const refreshUseCase = new RequestDisplayRefreshUseCase({
      displayRepository: repo,
    });

    const before = await manifestUseCase.execute({
      displayId: created.id,
      now: new Date("2025-01-06T00:00:00.000Z"),
    });
    await refreshUseCase.execute({ id: created.id });
    const after = await manifestUseCase.execute({
      displayId: created.id,
      now: new Date("2025-01-06T00:00:00.000Z"),
    });

    expect(before.playlistVersion).not.toBe(after.playlistVersion);
  });

  test("GetDisplayManifestUseCase batches content lookups for manifest items", async () => {
    const { repo } = makeRepository();
    const created = await repo.create({
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
    });

    let findByIdCalls = 0;
    let findByIdsCalls = 0;

    const contentRepository = {
      findById: async () => {
        findByIdCalls += 1;
        return {
          id: "content-1",
          title: "Welcome",
          type: "IMAGE" as const,
          status: "READY" as const,
          fileKey: "content/images/a.png",
          checksum: "abc",
          mimeType: "image/png",
          fileSize: 100,
          width: 10,
          height: 10,
          duration: null,
          createdById: "user-1",
          createdAt: "2025-01-01T00:00:00.000Z",
        };
      },
      findByIds: async (ids: string[]) => {
        findByIdsCalls += 1;
        return ids.map((id) => ({
          id,
          title: "Welcome",
          type: "IMAGE" as const,
          status: "READY" as const,
          fileKey: "content/images/a.png",
          checksum: "abc",
          mimeType: "image/png",
          fileSize: 100,
          width: 10,
          height: 10,
          duration: null,
          createdById: "user-1",
          createdAt: "2025-01-01T00:00:00.000Z",
        }));
      },
      create: async () => {
        throw new Error("not used");
      },
      list: async () => ({ items: [], total: 0 }),
      countPlaylistReferences: async () => 0,
      listPlaylistsReferencingContent: async () => [],
      delete: async () => false,
    };

    const useCase = new GetDisplayManifestUseCase({
      scheduleRepository: {
        listByDisplay: async () => [
          {
            id: "schedule-1",
            name: "Morning",
            playlistId: "playlist-1",
            displayId: created.id,
            startTime: "00:00",
            endTime: "23:59",
            priority: 10,
            isActive: true,
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
          },
        ],
        list: async () => [],
        findById: async () => null,
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        delete: async () => false,
        countByPlaylistId: async () => 0,
        listByPlaylistId: async () => [],
      },
      playlistRepository: {
        list: async () => [],
        listPage: async () => ({ items: [], total: 0 }),
        findByIds: async (ids: string[]) =>
          ids.includes("playlist-1")
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
            : [],
        findById: async () => ({
          id: "playlist-1",
          name: "Morning",
          description: null,
          createdById: "user-1",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }),
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        updateStatus: async () => undefined,
        delete: async () => false,
        listItems: async () => [
          {
            id: "item-1",
            playlistId: "playlist-1",
            contentId: "content-1",
            sequence: 10,
            duration: 5,
          },
          {
            id: "item-2",
            playlistId: "playlist-1",
            contentId: "content-1",
            sequence: 20,
            duration: 5,
          },
        ],
        findItemById: async () => null,
        countItemsByContentId: async () => 0,
        addItem: async () => {
          throw new Error("not used");
        },
        updateItem: async () => null,
        reorderItems: async () => true,
        deleteItem: async () => false,
      },
      contentRepository: contentRepository as never,
      contentStorage: {
        ensureBucketExists: async () => {},
        upload: async () => {},
        delete: async () => {},
        getPresignedDownloadUrl: async () => "https://example.com/file",
      },
      displayRepository: repo,
      downloadUrlExpiresInSeconds: 3600,
    });

    await useCase.execute({
      displayId: created.id,
      now: new Date("2025-01-06T00:00:00.000Z"),
    });

    expect(findByIdsCalls).toBe(1);
    expect(findByIdCalls).toBe(0);
  });

  test("GetDisplayManifestUseCase presigns content URLs concurrently", async () => {
    const { repo } = makeRepository();
    const created = await repo.create({
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
    });

    let resolveFirst!: () => void;
    let resolveSecondStarted!: () => void;
    const firstCanComplete = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const secondStarted = new Promise<void>((resolve) => {
      resolveSecondStarted = resolve;
    });

    const useCase = new GetDisplayManifestUseCase({
      scheduleRepository: {
        listByDisplay: async () => [
          {
            id: "schedule-1",
            name: "Morning",
            playlistId: "playlist-1",
            displayId: created.id,
            startTime: "00:00",
            endTime: "23:59",
            priority: 10,
            isActive: true,
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
          },
        ],
        list: async () => [],
        findById: async () => null,
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        delete: async () => false,
        countByPlaylistId: async () => 0,
        listByPlaylistId: async () => [],
      },
      playlistRepository: {
        list: async () => [],
        listPage: async () => ({ items: [], total: 0 }),
        findByIds: async (ids: string[]) =>
          ids.includes("playlist-1")
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
            : [],
        findById: async () => ({
          id: "playlist-1",
          name: "Morning",
          description: null,
          createdById: "user-1",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }),
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        updateStatus: async () => undefined,
        delete: async () => false,
        listItems: async () => [
          {
            id: "item-1",
            playlistId: "playlist-1",
            contentId: "content-1",
            sequence: 10,
            duration: 5,
          },
          {
            id: "item-2",
            playlistId: "playlist-1",
            contentId: "content-2",
            sequence: 20,
            duration: 5,
          },
        ],
        findItemById: async () => null,
        countItemsByContentId: async () => 0,
        addItem: async () => {
          throw new Error("not used");
        },
        updateItem: async () => null,
        reorderItems: async () => true,
        deleteItem: async () => false,
      },
      contentRepository: {
        findById: async () => null,
        findByIds: async () => [
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
            createdById: "user-1",
            createdAt: "2025-01-01T00:00:00.000Z",
          },
          {
            id: "content-2",
            title: "Rules",
            type: "PDF",
            status: "READY",
            fileKey: "content/documents/b.pdf",
            checksum: "def",
            mimeType: "application/pdf",
            fileSize: 100,
            width: null,
            height: null,
            duration: null,
            createdById: "user-1",
            createdAt: "2025-01-01T00:00:00.000Z",
          },
        ],
        create: async () => {
          throw new Error("not used");
        },
        list: async () => ({ items: [], total: 0 }),
        countPlaylistReferences: async () => 0,
        listPlaylistsReferencingContent: async () => [],
        delete: async () => false,
        update: async () => null,
      },
      contentStorage: {
        ensureBucketExists: async () => {},
        upload: async () => {},
        delete: async () => {},
        getPresignedDownloadUrl: async ({ key }) => {
          if (key === "content/images/a.png") {
            await firstCanComplete;
            return "https://example.com/a.png";
          }

          resolveSecondStarted();
          return "https://example.com/b.pdf";
        },
      },
      displayRepository: repo,
      downloadUrlExpiresInSeconds: 3600,
    });

    const executePromise = useCase.execute({
      displayId: created.id,
      now: new Date("2025-01-06T00:00:00.000Z"),
    });

    const startedConcurrently = await Promise.race([
      secondStarted.then(() => true),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 50);
      }),
    ]);
    resolveFirst();
    expect(startedConcurrently).toBe(true);
    const result = await executePromise;
    expect(result.items).toHaveLength(2);
  });
});
