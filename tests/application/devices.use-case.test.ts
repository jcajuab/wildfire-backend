import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { ValidationError } from "#/application/errors/validation";
import { type DevicePairingCodeRepository } from "#/application/ports/device-pairing";
import {
  type DeviceRecord,
  type DeviceRepository,
} from "#/application/ports/devices";
import {
  GetDeviceManifestUseCase,
  GetDeviceUseCase,
  IssueDevicePairingCodeUseCase,
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
    findByFingerprint: async (fingerprint: string) =>
      records.find((record) => record.deviceFingerprint === fingerprint) ??
      null,
    create: async (input) => {
      const record: DeviceRecord = {
        id: `device-${records.length + 1}`,
        name: input.name,
        identifier: input.identifier,
        deviceFingerprint: input.deviceFingerprint ?? null,
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
    update: async (id, input) => {
      const record = records.find((item) => item.id === id);
      if (!record) return null;
      if (input.name !== undefined) record.name = input.name;
      if (input.identifier !== undefined) record.identifier = input.identifier;
      if (input.deviceFingerprint !== undefined)
        record.deviceFingerprint = input.deviceFingerprint;
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

const hashPairingCode = (code: string): string =>
  createHash("sha256").update(code).digest("hex");

const makePairingRepository = () => {
  const records: Array<{
    id: string;
    codeHash: string;
    expiresAt: Date;
    usedAt: Date | null;
    createdById: string;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  const repository: DevicePairingCodeRepository = {
    create: async (input) => {
      const now = new Date();
      const record = {
        id: crypto.randomUUID(),
        codeHash: input.codeHash,
        expiresAt: input.expiresAt,
        usedAt: null,
        createdById: input.createdById,
        createdAt: now,
        updatedAt: now,
      };
      records.push(record);
      return {
        id: record.id,
        codeHash: record.codeHash,
        expiresAt: record.expiresAt.toISOString(),
        usedAt: null,
        createdById: record.createdById,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      };
    },
    consumeValidCode: async ({ codeHash, now }) => {
      const record = records.find(
        (item) =>
          item.codeHash === codeHash &&
          item.usedAt === null &&
          item.expiresAt.getTime() > now.getTime(),
      );
      if (!record) return null;
      record.usedAt = now;
      record.updatedAt = now;
      return {
        id: record.id,
        codeHash: record.codeHash,
        expiresAt: record.expiresAt.toISOString(),
        usedAt: record.usedAt.toISOString(),
        createdById: record.createdById,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      };
    },
  };

  const issueCode = (code: string, options?: { expiresAt?: Date }) => {
    const now = new Date();
    records.push({
      id: crypto.randomUUID(),
      codeHash: hashPairingCode(code),
      expiresAt: options?.expiresAt ?? new Date(now.getTime() + 10 * 60 * 1000),
      usedAt: null,
      createdById: "user-1",
      createdAt: now,
      updatedAt: now,
    });
  };

  return { repository, issueCode, records };
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

  test("ListDevicesUseCase maps onlineStatus from lastSeenAt", async () => {
    const { repo, records } = makeRepository();
    const listDevices = new ListDevicesUseCase({ deviceRepository: repo });

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

    const recentSeenAt = new Date(Date.now() - 60 * 1000).toISOString();
    const staleSeenAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const neverSeen = records.find((record) => record.name === "Never seen");
    const recentlySeen = records.find(
      (record) => record.name === "Recently seen",
    );
    const staleHeartbeat = records.find(
      (record) => record.name === "Stale heartbeat",
    );

    if (!neverSeen || !recentlySeen || !staleHeartbeat) {
      throw new Error("Expected seeded device records to exist");
    }

    neverSeen.lastSeenAt = null;
    recentlySeen.lastSeenAt = recentSeenAt;
    staleHeartbeat.lastSeenAt = staleSeenAt;

    const result = await listDevices.execute();
    const statusByIdentifier = new Map(
      result.items.map((item) => [item.identifier, item.onlineStatus]),
    );

    expect(statusByIdentifier.get(neverSeen.identifier)).toBe("DOWN");
    expect(statusByIdentifier.get(recentlySeen.identifier)).toBe("LIVE");
    expect(statusByIdentifier.get(staleHeartbeat.identifier)).toBe("READY");
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
    const { repository: pairingCodeRepository, issueCode } =
      makePairingRepository();
    issueCode("123456");
    const registerDevice = new RegisterDeviceUseCase({
      deviceRepository: repo,
      devicePairingCodeRepository: pairingCodeRepository,
    });

    const device = await registerDevice.execute({
      pairingCode: "123456",
      name: "Lobby",
      identifier: "AA:BB",
      location: "Main Hall",
      screenWidth: 1366,
      screenHeight: 768,
    });

    expect(device.identifier).toBe("AA:BB");
  });

  test("RegisterDeviceUseCase updates existing device", async () => {
    const { repo } = makeRepository();
    const { repository: pairingCodeRepository, issueCode } =
      makePairingRepository();
    const registerDevice = new RegisterDeviceUseCase({
      deviceRepository: repo,
      devicePairingCodeRepository: pairingCodeRepository,
    });

    const created = await repo.create({
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
    });

    issueCode("234567");
    const updated = await registerDevice.execute({
      pairingCode: "234567",
      name: "Lobby Display",
      identifier: "AA:BB",
      location: "Hallway",
      screenWidth: 1366,
      screenHeight: 768,
    });

    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("Lobby Display");
    expect(updated.location).toBe("Hallway");
  });

  test("RegisterDeviceUseCase reuses existing device by fingerprint", async () => {
    const { repo } = makeRepository();
    const { repository: pairingCodeRepository, issueCode } =
      makePairingRepository();
    const registerDevice = new RegisterDeviceUseCase({
      deviceRepository: repo,
      devicePairingCodeRepository: pairingCodeRepository,
    });

    issueCode("345678");
    const created = await registerDevice.execute({
      pairingCode: "345678",
      name: "Lobby",
      identifier: "old-identifier",
      deviceFingerprint: "fp-1",
      location: null,
      screenWidth: 1366,
      screenHeight: 768,
    });

    issueCode("456789");
    const updated = await registerDevice.execute({
      pairingCode: "456789",
      name: "Lobby Renamed",
      identifier: "new-identifier",
      deviceFingerprint: "fp-1",
      location: "Hallway",
      screenWidth: 1920,
      screenHeight: 1080,
    });

    expect(updated.id).toBe(created.id);
    expect(updated.identifier).toBe("new-identifier");
    expect(updated.deviceFingerprint).toBe("fp-1");
  });

  test("RegisterDeviceUseCase rejects conflicting identifier and fingerprint", async () => {
    const { repo } = makeRepository();
    const { repository: pairingCodeRepository, issueCode } =
      makePairingRepository();
    const registerDevice = new RegisterDeviceUseCase({
      deviceRepository: repo,
      devicePairingCodeRepository: pairingCodeRepository,
    });

    issueCode("567890");
    await registerDevice.execute({
      pairingCode: "567890",
      name: "Device A",
      identifier: "device-a",
      deviceFingerprint: "fp-a",
      location: null,
      screenWidth: 1366,
      screenHeight: 768,
    });
    issueCode("678901");
    await registerDevice.execute({
      pairingCode: "678901",
      name: "Device B",
      identifier: "device-b",
      deviceFingerprint: "fp-b",
      location: null,
      screenWidth: 1366,
      screenHeight: 768,
    });

    issueCode("789012");
    await expect(
      registerDevice.execute({
        pairingCode: "789012",
        name: "Conflict",
        identifier: "device-a",
        deviceFingerprint: "fp-b",
        location: null,
        screenWidth: 1366,
        screenHeight: 768,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("RegisterDeviceUseCase rejects invalid pairing code", async () => {
    const { repo } = makeRepository();
    const { repository: pairingCodeRepository } = makePairingRepository();
    const registerDevice = new RegisterDeviceUseCase({
      deviceRepository: repo,
      devicePairingCodeRepository: pairingCodeRepository,
    });

    await expect(
      registerDevice.execute({
        pairingCode: "111111",
        name: "Lobby",
        identifier: "AA:BB",
        location: null,
        screenWidth: 1366,
        screenHeight: 768,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("IssueDevicePairingCodeUseCase returns 6-digit code and expiry", async () => {
    const { repository: pairingCodeRepository } = makePairingRepository();
    const useCase = new IssueDevicePairingCodeUseCase({
      devicePairingCodeRepository: pairingCodeRepository,
    });

    const result = await useCase.execute({ createdById: "user-1" });

    expect(result.code).toMatch(/^\d{6}$/);
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
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
        countByPlaylistId: async () => 0,
        listBySeries: async () => [],
        deleteBySeries: async () => 0,
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
        upload: async () => {},
        delete: async () => {},
        getPresignedDownloadUrl: async () => "",
      },
      deviceRepository: repo,
      systemSettingRepository: {
        findByKey: async () => null,
        upsert: async () => {
          throw new Error("not used");
        },
      },
      downloadUrlExpiresInSeconds: 3600,
    });

    const result = await useCase.execute({
      deviceId: created.id,
      now: new Date("2025-01-01T00:00:00.000Z"),
    });

    expect(result.items).toHaveLength(0);
    expect(result.playlistId).toBeNull();
    expect(result.runtimeSettings.scrollPxPerSecond).toBe(24);
  });

  test("GetDeviceManifestUseCase uses persisted runtime scroll setting", async () => {
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
        countByPlaylistId: async () => 0,
        listBySeries: async () => [],
        deleteBySeries: async () => 0,
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
        upload: async () => {},
        delete: async () => {},
        getPresignedDownloadUrl: async () => "",
      },
      deviceRepository: repo,
      systemSettingRepository: {
        findByKey: async () => ({
          key: "device_runtime_scroll_px_per_second",
          value: "36",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }),
        upsert: async () => {
          throw new Error("not used");
        },
      },
      downloadUrlExpiresInSeconds: 3600,
    });

    const result = await useCase.execute({
      deviceId: created.id,
      now: new Date("2025-01-01T00:00:00.000Z"),
    });
    expect(result.runtimeSettings.scrollPxPerSecond).toBe(36);
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
            seriesId: "series-1",
            name: "Morning",
            playlistId: "playlist-1",
            deviceId: created.id,
            startTime: "00:00",
            endTime: "23:59",
            dayOfWeek: 1,
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
        listBySeries: async () => [],
        deleteBySeries: async () => 0,
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
        listPlaylistsReferencingContent: async () => [],
        delete: async () => false,
        update: async () => null,
      },
      contentStorage: {
        upload: async () => {},
        delete: async () => {},
        getPresignedDownloadUrl: async () => "https://example.com/file",
      },
      deviceRepository: repo,
      systemSettingRepository: {
        findByKey: async () => null,
        upsert: async () => {
          throw new Error("not used");
        },
      },
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
      listPlaylistsReferencingContent: async () => [],
      delete: async () => false,
    };

    const useCase = new GetDeviceManifestUseCase({
      scheduleRepository: {
        listByDevice: async () => [
          {
            id: "schedule-1",
            seriesId: "series-1",
            name: "Morning",
            playlistId: "playlist-1",
            deviceId: created.id,
            startTime: "00:00",
            endTime: "23:59",
            dayOfWeek: 1,
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
        listBySeries: async () => [],
        deleteBySeries: async () => 0,
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
        upload: async () => {},
        delete: async () => {},
        getPresignedDownloadUrl: async () => "https://example.com/file",
      },
      deviceRepository: repo,
      systemSettingRepository: {
        findByKey: async () => null,
        upsert: async () => {
          throw new Error("not used");
        },
      },
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
            seriesId: "series-1",
            name: "Morning",
            playlistId: "playlist-1",
            deviceId: created.id,
            startTime: "00:00",
            endTime: "23:59",
            dayOfWeek: 1,
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
        listBySeries: async () => [],
        deleteBySeries: async () => 0,
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
        listPlaylistsReferencingContent: async () => [],
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
      systemSettingRepository: {
        findByKey: async () => null,
        upsert: async () => {
          throw new Error("not used");
        },
      },
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
