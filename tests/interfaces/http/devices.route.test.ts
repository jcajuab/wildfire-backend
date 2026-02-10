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

const makeRepositories = () => {
  const devices = [] as Array<{
    id: string;
    name: string;
    identifier: string;
    location: string | null;
    createdAt: string;
    updatedAt: string;
  }>;

  return {
    devices,
    deviceRepository: {
      list: async () => [...devices],
      findById: async (id: string) =>
        devices.find((device) => device.id === id) ?? null,
      findByIdentifier: async (identifier: string) =>
        devices.find((device) => device.identifier === identifier) ?? null,
      create: async (input: {
        name: string;
        identifier: string;
        location: string | null;
      }) => {
        const record = {
          id: `device-${devices.length + 1}`,
          ...input,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        };
        devices.push(record);
        return record;
      },
      update: async (
        id: string,
        input: { name?: string; location?: string | null },
      ) => {
        const record = devices.find((device) => device.id === id);
        if (!record) return null;
        if (input.name !== undefined) record.name = input.name;
        if (input.location !== undefined) record.location = input.location;
        record.updatedAt = "2025-01-02T00:00:00.000Z";
        return record;
      },
    },
  };
};

const makeApp = async (permissions: string[] = []) => {
  const app = new Hono();
  const { devices, deviceRepository } = makeRepositories();
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
        findById: async (id: string) =>
          playlists.find((playlist) => playlist.id === id) ?? null,
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
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
        delete: async () => false,
      },
      authorizationRepository,
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
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    const token = await issueToken();
    const response = await app.request("/devices", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const json = await parseJson<{ items: Array<{ id: string }> }>(response);
    expect(json.items).toHaveLength(1);
  });

  test("GET /devices/:id returns device", async () => {
    const { app, issueToken, devices } = await makeApp(["devices:read"]);
    devices.push({
      id: deviceId,
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    const token = await issueToken();
    const response = await app.request(`/devices/${deviceId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
  });

  test("GET /devices/:id/manifest returns empty manifest", async () => {
    const { app, devices } = await makeApp();
    devices.push({
      id: deviceId,
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
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
