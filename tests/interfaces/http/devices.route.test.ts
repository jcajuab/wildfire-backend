import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { type ContentRecord } from "#/application/ports/content";
import { Permission } from "#/domain/rbac/permission";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { createDevicesRouter } from "#/interfaces/http/routes/devices.route";

const tokenIssuer = new JwtTokenIssuer({ secret: "test-secret" });
const parseJson = async <T>(response: Response) => (await response.json()) as T;
const deviceId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const playlistId = "b2c4a3f1-6b18-4f90-9d9b-9e1a2f0d9d45";
const contentId = "9c7b2f9a-2f5d-4bd9-9c9e-1f0c1d9b8c7a";

const makeRepositories = (options?: { registerDeviceError?: Error }) => {
  const devices = [] as Array<{
    id: string;
    name: string;
    identifier: string;
    location: string | null;
    screenWidth: number | null;
    screenHeight: number | null;
    outputType: string | null;
    orientation: "LANDSCAPE" | "PORTRAIT" | null;
    refreshNonce: number;
    createdAt: string;
    updatedAt: string;
  }>;
  const deviceGroups = [] as Array<{
    id: string;
    name: string;
    deviceIds: string[];
    createdAt: string;
    updatedAt: string;
  }>;

  return {
    devices,
    deviceGroups,
    deviceRepository: {
      list: async () => [...devices],
      findByIds: async (ids: string[]) =>
        devices.filter((device) => ids.includes(device.id)),
      findById: async (id: string) =>
        devices.find((device) => device.id === id) ?? null,
      findByIdentifier: async (identifier: string) =>
        devices.find((device) => device.identifier === identifier) ?? null,
      create: async (input: {
        name: string;
        identifier: string;
        location: string | null;
      }) => {
        if (options?.registerDeviceError) {
          throw options.registerDeviceError;
        }
        const record = {
          id: `device-${devices.length + 1}`,
          ...input,
          screenWidth: null,
          screenHeight: null,
          outputType: null,
          orientation: null,
          refreshNonce: 0,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        };
        devices.push(record);
        return record;
      },
      update: async (
        id: string,
        input: {
          name?: string;
          location?: string | null;
          screenWidth?: number | null;
          screenHeight?: number | null;
          outputType?: string | null;
          orientation?: "LANDSCAPE" | "PORTRAIT" | null;
        },
      ) => {
        const record = devices.find((device) => device.id === id);
        if (!record) return null;
        if (input.name !== undefined) record.name = input.name;
        if (input.location !== undefined) record.location = input.location;
        if (input.screenWidth !== undefined)
          record.screenWidth = input.screenWidth;
        if (input.screenHeight !== undefined)
          record.screenHeight = input.screenHeight;
        if (input.outputType !== undefined)
          record.outputType = input.outputType;
        if (input.orientation !== undefined)
          record.orientation = input.orientation;
        record.updatedAt = "2025-01-02T00:00:00.000Z";
        return record;
      },
      bumpRefreshNonce: async (id: string) => {
        const record = devices.find((device) => device.id === id);
        if (!record) return false;
        record.refreshNonce += 1;
        return true;
      },
    },
    deviceGroupRepository: {
      list: async () => [...deviceGroups],
      findById: async (id: string) =>
        deviceGroups.find((group) => group.id === id) ?? null,
      findByName: async (name: string) =>
        deviceGroups.find((group) => group.name === name) ?? null,
      create: async (input: { name: string }) => {
        const record = {
          id: crypto.randomUUID(),
          name: input.name,
          deviceIds: [],
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        };
        deviceGroups.push(record);
        return record;
      },
      update: async (id: string, input: { name?: string }) => {
        const group = deviceGroups.find((item) => item.id === id);
        if (!group) return null;
        if (input.name !== undefined) group.name = input.name;
        group.updatedAt = "2025-01-02T00:00:00.000Z";
        return group;
      },
      delete: async (id: string) => {
        const index = deviceGroups.findIndex((item) => item.id === id);
        if (index === -1) return false;
        deviceGroups.splice(index, 1);
        return true;
      },
      setDeviceGroups: async (deviceId: string, groupIds: string[]) => {
        for (const group of deviceGroups) {
          group.deviceIds = group.deviceIds.filter((id) => id !== deviceId);
        }
        for (const groupId of groupIds) {
          const group = deviceGroups.find((item) => item.id === groupId);
          if (group && !group.deviceIds.includes(deviceId)) {
            group.deviceIds.push(deviceId);
          }
        }
      },
    },
  };
};

const makeApp = async (
  permissions: string[] = [],
  options?: { registerDeviceError?: Error },
) => {
  const app = new Hono();
  const { devices, deviceRepository, deviceGroupRepository } =
    makeRepositories(options);
  const playlists = [
    {
      id: playlistId,
      name: "Morning",
      description: null,
      createdById: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  ];
  const contents: ContentRecord[] = [
    {
      id: contentId,
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
  ];
  const authorizationRepository = {
    findPermissionsForUser: async () =>
      permissions.map((permission) => Permission.parse(permission)),
  };

  const router = createDevicesRouter({
    jwtSecret: "test-secret",
    deviceApiKey: "device-key",
    downloadUrlExpiresInSeconds: 3600,
    repositories: {
      deviceRepository,
      scheduleRepository: {
        list: async () => [],
        listByDevice: async () => [],
        findById: async () => null,
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        delete: async () => false,
      },
      playlistRepository: {
        list: async () => playlists,
        listPage: async ({ offset, limit }) => ({
          items: playlists.slice(offset, offset + limit),
          total: playlists.length,
        }),
        findByIds: async (ids: string[]) =>
          playlists.filter((playlist) => ids.includes(playlist.id)),
        findById: async (id: string) =>
          playlists.find((playlist) => playlist.id === id) ?? null,
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        updateStatus: async () => undefined,
        delete: async () => false,
        listItems: async () => [
          {
            id: "item-1",
            playlistId,
            contentId,
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
        findById: async (id: string) =>
          contents.find((content) => content.id === id) ?? null,
        findByIds: async (ids: string[]) =>
          contents.filter((content) => ids.includes(content.id)),
        create: async () => {
          throw new Error("not used");
        },
        list: async () => ({ items: [], total: 0 }),
        countPlaylistReferences: async () => 0,
        delete: async () => false,
        update: async () => null,
      },
      authorizationRepository,
      deviceGroupRepository,
    },
    storage: {
      upload: async () => {},
      delete: async () => {},
      getPresignedDownloadUrl: async () => "https://example.com/file",
    },
  });

  app.route("/devices", router);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const issueToken = async () =>
    tokenIssuer.issueToken({
      subject: "user-1",
      email: "user@example.com",
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + 3600,
      issuer: undefined,
    });

  return { app, issueToken, devices };
};

describe("Devices routes", () => {
  test("POST /devices registers device with API key", async () => {
    const { app } = await makeApp();
    const response = await app.request("/devices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "device-key",
      },
      body: JSON.stringify({
        name: "Lobby",
        identifier: "AA:BB",
        location: "Hall",
      }),
    });

    expect(response.status).toBe(200);
    const json = await parseJson<{ id: string }>(response);
    expect(json.id).toBeDefined();
  });

  test("POST /devices returns 401 without API key", async () => {
    const { app } = await makeApp();
    const response = await app.request("/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Lobby", identifier: "AA:BB" }),
    });

    expect(response.status).toBe(401);
  });

  test("POST /devices returns 500 on unexpected repository failure", async () => {
    const { app } = await makeApp([], {
      registerDeviceError: new Error("db unavailable"),
    });
    const response = await app.request("/devices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "device-key",
      },
      body: JSON.stringify({ name: "Lobby", identifier: "AA:BB" }),
    });

    expect(response.status).toBe(500);
  });

  test("GET /devices/:id/manifest returns 401 without API key", async () => {
    const { app } = await makeApp();
    const response = await app.request(`/devices/${deviceId}/manifest`);
    expect(response.status).toBe(401);
  });

  test("GET /devices/:id/active-schedule returns 401 without API key", async () => {
    const { app } = await makeApp();
    const response = await app.request(`/devices/${deviceId}/active-schedule`);
    expect(response.status).toBe(401);
  });

  test("GET /devices requires permission", async () => {
    const { app, issueToken } = await makeApp([]);
    const token = await issueToken();
    const response = await app.request("/devices", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(403);
  });

  test("GET /devices returns list with permission", async () => {
    const { app, issueToken, devices } = await makeApp(["devices:read"]);
    devices.push({
      id: deviceId,
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      refreshNonce: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    const token = await issueToken();
    const response = await app.request("/devices", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const json = await parseJson<{
      items: Array<{ id: string }>;
      total: number;
      page: number;
      pageSize: number;
    }>(response);
    expect(json.items).toHaveLength(1);
    expect(json.total).toBe(1);
    expect(json.page).toBe(1);
    expect(json.pageSize).toBe(50);
  });

  test("GET /devices/:id returns device", async () => {
    const { app, issueToken, devices } = await makeApp(["devices:read"]);
    devices.push({
      id: deviceId,
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      refreshNonce: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    const token = await issueToken();
    const response = await app.request(`/devices/${deviceId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
  });

  test("PATCH /devices/:id updates device with devices:update permission", async () => {
    const { app, issueToken, devices } = await makeApp(["devices:update"]);
    devices.push({
      id: deviceId,
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      refreshNonce: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    const token = await issueToken();

    const response = await app.request(`/devices/${deviceId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Lobby TV",
        location: "Main Hall",
        outputType: "HDMI-0",
        screenWidth: 1920,
        screenHeight: 1080,
        orientation: "LANDSCAPE",
      }),
    });

    expect(response.status).toBe(200);
    const json = await parseJson<{
      name: string;
      location: string | null;
      outputType: string | null;
      screenWidth: number | null;
      screenHeight: number | null;
      orientation: "LANDSCAPE" | "PORTRAIT" | null;
    }>(response);
    expect(json.name).toBe("Lobby TV");
    expect(json.location).toBe("Main Hall");
    expect(json.outputType).toBe("HDMI-0");
    expect(json.screenWidth).toBe(1920);
    expect(json.screenHeight).toBe(1080);
    expect(json.orientation).toBe("LANDSCAPE");
  });

  test("POST /devices/:id/refresh queues refresh with devices:update permission", async () => {
    const { app, issueToken, devices } = await makeApp(["devices:update"]);
    devices.push({
      id: deviceId,
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      refreshNonce: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    const token = await issueToken();
    const response = await app.request(`/devices/${deviceId}/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(204);
    expect(devices[0]?.refreshNonce).toBe(1);
  });

  test("POST /devices/:id/refresh returns 403 without permission", async () => {
    const { app, issueToken, devices } = await makeApp(["devices:read"]);
    devices.push({
      id: deviceId,
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      refreshNonce: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    const token = await issueToken();
    const response = await app.request(`/devices/${deviceId}/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(403);
  });

  test("POST /devices/:id/refresh returns 404 for missing device", async () => {
    const { app, issueToken } = await makeApp(["devices:update"]);
    const token = await issueToken();

    const response = await app.request(`/devices/${deviceId}/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(404);
  });

  test("GET /devices/groups returns groups with devices:read permission", async () => {
    const { app, issueToken, devices } = await makeApp(["devices:read"]);
    devices.push({
      id: deviceId,
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      refreshNonce: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    const token = await issueToken();
    const createResponse = await app.request("/devices/groups", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Lobby Group" }),
    });
    expect(createResponse.status).toBe(403);

    const elevated = await makeApp(["devices:read", "devices:update"]);
    const elevatedToken = await elevated.issueToken();
    const createOk = await elevated.app.request("/devices/groups", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${elevatedToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Lobby Group" }),
    });
    expect(createOk.status).toBe(200);

    const listResponse = await elevated.app.request("/devices/groups", {
      headers: { Authorization: `Bearer ${elevatedToken}` },
    });
    expect(listResponse.status).toBe(200);
    const json = await parseJson<{ items: Array<{ name: string }> }>(
      listResponse,
    );
    expect(json.items.some((group) => group.name === "Lobby Group")).toBe(true);
  });

  test("GET /devices/:id/manifest returns empty manifest", async () => {
    const { app, devices } = await makeApp();
    devices.push({
      id: deviceId,
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      refreshNonce: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    const response = await app.request(`/devices/${deviceId}/manifest`, {
      headers: { "X-API-Key": "device-key" },
    });

    expect(response.status).toBe(200);
    const json = await parseJson<{ playlistId: string | null }>(response);
    expect(json.playlistId).toBeNull();
  });

  test("GET /devices/:id/active-schedule returns null when none", async () => {
    const { app, devices } = await makeApp();
    devices.push({
      id: deviceId,
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      refreshNonce: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    const response = await app.request(`/devices/${deviceId}/active-schedule`, {
      headers: { "X-API-Key": "device-key" },
    });

    expect(response.status).toBe(200);
    const json = await parseJson<unknown>(response);
    expect(json).toBeNull();
  });
});
