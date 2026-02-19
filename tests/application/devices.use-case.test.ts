import { describe, expect, test } from "bun:test";
import {
  type DeviceRecord,
  type DeviceRepository,
} from "#/application/ports/devices";
import {
  GetDeviceManifestUseCase,
  GetDeviceUseCase,
  ListDevicesUseCase,
  NotFoundError,
  RegisterDeviceUseCase,
  RequestDeviceRefreshUseCase,
  UpdateDeviceUseCase,
} from "#/application/use-cases/devices";

const makeRepository = () => {
  const records: DeviceRecord[] = [];

  const repo: DeviceRepository = {
    list: async () => [...records],
    findByIds: async (ids: string[]) =>
      ids
        .map((id) => records.find((record) => record.id === id) ?? null)
        .filter((record): record is DeviceRecord => record !== null),
    findById: async (id: string) =>
      records.find((record) => record.id === id) ?? null,
    findByIdentifier: async (identifier: string) =>
      records.find((record) => record.identifier === identifier) ?? null,
    create: async (input) => {
      const record: DeviceRecord = {
        id: `device-${records.length + 1}`,
        name: input.name,
        identifier: input.identifier,
        location: input.location,
        screenWidth: null,
        screenHeight: null,
        outputType: null,
        orientation: null,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      };
      records.push(record);
      return record;
    },
    update: async (id, input) => {
      const record = records.find((item) => item.id === id);
      if (!record) return null;
      if (input.name !== undefined) record.name = input.name;
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
    bumpRefreshNonce: async (id: string) => {
      const record = records.find((item) => item.id === id);
      if (!record) return false;
      record.refreshNonce = (record.refreshNonce ?? 0) + 1;
      return true;
    },
  };

  return { repo, records };
};

describe("Devices use cases", () => {
  test("ListDevicesUseCase returns devices", async () => {
    const { repo } = makeRepository();
    const listDevices = new ListDevicesUseCase({ deviceRepository: repo });

    await repo.create({
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
    });

    const result = await listDevices.execute();
    expect(result.items).toHaveLength(1);
  });

  test("GetDeviceUseCase throws when missing", async () => {
    const { repo } = makeRepository();
    const getDevice = new GetDeviceUseCase({ deviceRepository: repo });

    await expect(getDevice.execute({ id: "missing" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("RegisterDeviceUseCase creates new device", async () => {
    const { repo } = makeRepository();
    const registerDevice = new RegisterDeviceUseCase({
      deviceRepository: repo,
    });

    const device = await registerDevice.execute({
      name: "Lobby",
      identifier: "AA:BB",
      location: "Main Hall",
    });

    expect(device.identifier).toBe("AA:BB");
  });

  test("RegisterDeviceUseCase updates existing device", async () => {
    const { repo } = makeRepository();
    const registerDevice = new RegisterDeviceUseCase({
      deviceRepository: repo,
    });

    const created = await repo.create({
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
    });

    const updated = await registerDevice.execute({
      name: "Lobby Display",
      identifier: "AA:BB",
      location: "Hallway",
    });

    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("Lobby Display");
    expect(updated.location).toBe("Hallway");
  });

  test("UpdateDeviceUseCase updates mutable device fields", async () => {
    const { repo } = makeRepository();
    const created = await repo.create({
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
    });

    const updateDevice = new UpdateDeviceUseCase({
      deviceRepository: repo,
    });
    const updated = await updateDevice.execute({
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

  test("RequestDeviceRefreshUseCase increments refresh nonce", async () => {
    const { repo } = makeRepository();
    const created = await repo.create({
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
    });

    const useCase = new RequestDeviceRefreshUseCase({
      deviceRepository: repo,
    });

    await useCase.execute({ id: created.id });

    const refreshed = await repo.findById(created.id);
    expect(refreshed?.refreshNonce).toBe(1);
  });

  test("GetDeviceManifestUseCase returns empty when no schedule", async () => {
    const { repo } = makeRepository();
    const created = await repo.create({
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
    });

    const useCase = new GetDeviceManifestUseCase({
      scheduleRepository: {
        listByDevice: async () => [],
        list: async () => [],
        findById: async () => null,
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        delete: async () => false,
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
        delete: async () => false,
        update: async () => null,
      },
      contentStorage: {
        upload: async () => {},
        delete: async () => {},
        getPresignedDownloadUrl: async () => "",
      },
      deviceRepository: repo,
      downloadUrlExpiresInSeconds: 3600,
    });

    const result = await useCase.execute({
      deviceId: created.id,
      now: new Date("2025-01-01T00:00:00.000Z"),
    });

    expect(result.items).toHaveLength(0);
    expect(result.playlistId).toBeNull();
  });

  test("GetDeviceManifestUseCase version changes after refresh request", async () => {
    const { repo } = makeRepository();
    const created = await repo.create({
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
    });

    const manifestUseCase = new GetDeviceManifestUseCase({
      scheduleRepository: {
        listByDevice: async () => [
          {
            id: "schedule-1",
            name: "Morning",
            playlistId: "playlist-1",
            deviceId: created.id,
            startTime: "00:00",
            endTime: "23:59",
            daysOfWeek: [1],
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
        deleteItem: async () => false,
      },
      contentRepository: {
        findById: async () => null,
        findByIds: async () => [
          {
            id: "content-1",
            title: "Welcome",
            type: "IMAGE",
            status: "DRAFT",
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
        delete: async () => false,
        update: async () => null,
      },
      contentStorage: {
        upload: async () => {},
        delete: async () => {},
        getPresignedDownloadUrl: async () => "https://example.com/file",
      },
      deviceRepository: repo,
      downloadUrlExpiresInSeconds: 3600,
    });

    const refreshUseCase = new RequestDeviceRefreshUseCase({
      deviceRepository: repo,
    });

    const before = await manifestUseCase.execute({
      deviceId: created.id,
      now: new Date("2025-01-06T00:00:00.000Z"),
    });
    await refreshUseCase.execute({ id: created.id });
    const after = await manifestUseCase.execute({
      deviceId: created.id,
      now: new Date("2025-01-06T00:00:00.000Z"),
    });

    expect(before.playlistVersion).not.toBe(after.playlistVersion);
  });

  test("GetDeviceManifestUseCase batches content lookups for manifest items", async () => {
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
          status: "DRAFT" as const,
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
          status: "DRAFT" as const,
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
      delete: async () => false,
    };

    const useCase = new GetDeviceManifestUseCase({
      scheduleRepository: {
        listByDevice: async () => [
          {
            id: "schedule-1",
            name: "Morning",
            playlistId: "playlist-1",
            deviceId: created.id,
            startTime: "00:00",
            endTime: "23:59",
            daysOfWeek: [1],
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
        deleteItem: async () => false,
      },
      contentRepository: contentRepository as never,
      contentStorage: {
        upload: async () => {},
        delete: async () => {},
        getPresignedDownloadUrl: async () => "https://example.com/file",
      },
      deviceRepository: repo,
      downloadUrlExpiresInSeconds: 3600,
    });

    await useCase.execute({
      deviceId: created.id,
      now: new Date("2025-01-06T00:00:00.000Z"),
    });

    expect(findByIdsCalls).toBe(1);
    expect(findByIdCalls).toBe(0);
  });

  test("GetDeviceManifestUseCase presigns content URLs concurrently", async () => {
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

    const useCase = new GetDeviceManifestUseCase({
      scheduleRepository: {
        listByDevice: async () => [
          {
            id: "schedule-1",
            name: "Morning",
            playlistId: "playlist-1",
            deviceId: created.id,
            startTime: "00:00",
            endTime: "23:59",
            daysOfWeek: [1],
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
        deleteItem: async () => false,
      },
      contentRepository: {
        findById: async () => null,
        findByIds: async () => [
          {
            id: "content-1",
            title: "Welcome",
            type: "IMAGE",
            status: "DRAFT",
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
            status: "DRAFT",
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
        delete: async () => false,
        update: async () => null,
      },
      contentStorage: {
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
      deviceRepository: repo,
      downloadUrlExpiresInSeconds: 3600,
    });

    const executePromise = useCase.execute({
      deviceId: created.id,
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
