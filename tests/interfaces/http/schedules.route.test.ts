import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { Permission } from "#/domain/rbac/permission";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { createSchedulesRouter } from "#/interfaces/http/routes/schedules.route";

const tokenIssuer = new JwtTokenIssuer({ secret: "test-secret" });
const parseJson = async <T>(response: Response) => (await response.json()) as T;
const playlistId = "b2c4a3f1-6b18-4f90-9d9b-9e1a2f0d9d45";
const deviceId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

const makeApp = async (
  permissions: string[],
  options?: { createScheduleError?: Error },
) => {
  const app = new Hono();
  const schedules: Array<{
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
  }> = [];
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
  const devices = [
    {
      id: deviceId,
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  ];

  const router = createSchedulesRouter({
    jwtSecret: "test-secret",
    repositories: {
      scheduleRepository: {
        list: async () => [...schedules],
        listByDevice: async () => [],
        findById: async (id: string) =>
          schedules.find((schedule) => schedule.id === id) ?? null,
        create: async (input) => {
          if (options?.createScheduleError) {
            throw options.createScheduleError;
          }
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
        countByPlaylistId: async () => 0,
      },
      playlistRepository: {
        list: async () => [...playlists],
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
        list: async () => [...devices],
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
      },
      authorizationRepository: {
        findPermissionsForUser: async () =>
          permissions.map((permission) => Permission.parse(permission)),
      },
    },
  });

  app.route("/schedules", router);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const issueToken = async () =>
    tokenIssuer.issueToken({
      subject: "user-1",
      email: "user@example.com",
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + 3600,
      issuer: undefined,
    });

  return { app, issueToken };
};

describe("Schedules routes", () => {
  test("GET /schedules returns list with permission", async () => {
    const { app, issueToken } = await makeApp(["schedules:read"]);
    const token = await issueToken();

    const response = await app.request("/schedules", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      items: Array<{ id: string }>;
      total: number;
      page: number;
      pageSize: number;
    }>(response);
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe("number");
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
  });

  test("POST /schedules creates schedule", async () => {
    const { app, issueToken } = await makeApp(["schedules:create"]);
    const token = await issueToken();

    const response = await app.request("/schedules", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Morning",
        playlistId,
        deviceId,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        startTime: "08:00",
        endTime: "17:00",
        daysOfWeek: [1, 2, 3],
        priority: 10,
        isActive: true,
      }),
    });

    expect(response.status).toBe(201);
    const json = await parseJson<{ id: string }>(response);
    expect(json.id).toBeDefined();
  });

  test("POST /schedules returns 404 when playlist missing", async () => {
    const { app, issueToken } = await makeApp(["schedules:create"]);
    const token = await issueToken();

    const response = await app.request("/schedules", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Morning",
        playlistId: "0e2c9b1e-7c1a-4b4d-8c2e-7b0a2f5f6d8c",
        deviceId,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        startTime: "08:00",
        endTime: "17:00",
        daysOfWeek: [1, 2, 3],
        priority: 10,
        isActive: true,
      }),
    });

    expect(response.status).toBe(404);
  });

  test("POST /schedules returns 400 for invalid time", async () => {
    const { app, issueToken } = await makeApp(["schedules:create"]);
    const token = await issueToken();

    const response = await app.request("/schedules", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Morning",
        playlistId,
        deviceId,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        startTime: "99:00",
        endTime: "17:00",
        daysOfWeek: [1, 2, 3],
        priority: 10,
        isActive: true,
      }),
    });

    expect(response.status).toBe(400);
  });

  test("POST /schedules returns 500 when repository fails unexpectedly", async () => {
    const { app, issueToken } = await makeApp(["schedules:create"], {
      createScheduleError: new Error("db unavailable"),
    });
    const token = await issueToken();

    const response = await app.request("/schedules", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Morning",
        playlistId,
        deviceId,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        startTime: "08:00",
        endTime: "17:00",
        daysOfWeek: [1, 2, 3],
        priority: 10,
        isActive: true,
      }),
    });

    expect(response.status).toBe(500);
  });
});
