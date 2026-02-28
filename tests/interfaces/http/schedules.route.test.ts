import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { Permission } from "#/domain/rbac/permission";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { createSchedulesRouter } from "#/interfaces/http/routes/schedules.route";

const tokenIssuer = new JwtTokenIssuer({ secret: "test-secret" });
const parseJson = async <T>(response: Response) => (await response.json()) as T;
const playlistId = "b2c4a3f1-6b18-4f90-9d9b-9e1a2f0d9d45";
const displayId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

const makeApp = async (
  permissions: string[],
  options?: { createScheduleError?: Error },
) => {
  const app = new Hono();
  const schedules: Array<{
    id: string;
    seriesId?: string;
    name: string;
    playlistId: string;
    displayId: string;
    startDate?: string;
    endDate?: string;
    startTime: string;
    endTime: string;
    dayOfWeek?: number;
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
  const displays = [
    {
      id: displayId,
      name: "Lobby",
      identifier: "AA:BB",
      location: null,
      screenWidth: 1366,
      screenHeight: 768,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  ];

  const router = createSchedulesRouter({
    jwtSecret: "test-secret",
    repositories: {
      scheduleRepository: {
        list: async () => [...schedules],
        listByDisplay: async (displayId: string) =>
          schedules.filter((schedule) => schedule.displayId === displayId),
        listBySeries: async (seriesId: string) =>
          schedules.filter((schedule) => schedule.seriesId === seriesId),
        findById: async (id: string) =>
          schedules.find((schedule) => schedule.id === id) ?? null,
        create: async (input) => {
          if (options?.createScheduleError) {
            throw options.createScheduleError;
          }
          const suffix = String(schedules.length + 1).padStart(12, "0");
          const record = {
            id: `00000000-0000-4000-8000-${suffix}`,
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
            ...input,
          };
          schedules.push(record);
          return record;
        },
        update: async (id, input) => {
          const index = schedules.findIndex((schedule) => schedule.id === id);
          if (index === -1) return null;
          const current = schedules[index];
          if (!current) return null;
          const next = { ...current, ...input };
          schedules[index] = next;
          return next;
        },
        delete: async (id) => {
          const index = schedules.findIndex((schedule) => schedule.id === id);
          if (index === -1) return false;
          schedules.splice(index, 1);
          return true;
        },
        countByPlaylistId: async (id) =>
          schedules.filter((schedule) => schedule.playlistId === id).length,
        deleteBySeries: async (seriesId) => {
          const before = schedules.length;
          const remaining = schedules.filter(
            (schedule) => schedule.seriesId !== seriesId,
          );
          schedules.splice(0, schedules.length, ...remaining);
          return before - schedules.length;
        },
        listByPlaylistId: async (playlistId: string) =>
          schedules.filter((schedule) => schedule.playlistId === playlistId),
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
        reorderItems: async () => true,
        deleteItem: async () => false,
      },
      displayRepository: {
        list: async () => [...displays],
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
      },
      authorizationRepository: {
        findPermissionsForUser: async () =>
          permissions.map((permission) => Permission.parse(permission)),
      },
      contentRepository: {
        create: async () => {
          throw new Error("not used");
        },
        findById: async () => null,
        findByIds: async () => [],
        list: async () => ({ items: [], total: 0 }),
        update: async () => null,
        countPlaylistReferences: async () => 0,
        listPlaylistsReferencingContent: async () => [],
        delete: async () => false,
      },
      systemSettingRepository: {
        findByKey: async () => null,
        upsert: async (input) => ({
          key: input.key,
          value: input.value,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }),
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
      data: Array<{ id: string }>;
      meta: {
        total: number;
        page: number;
        per_page: number;
        total_pages: number;
      };
    }>(response);
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.meta.total).toBe("number");
    expect(body.meta.page).toBe(1);
    expect(body.meta.per_page).toBe(50);
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
        displayId,
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
        displayId,
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

  test("POST /schedules returns 422 for invalid time", async () => {
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
        displayId,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        startTime: "99:00",
        endTime: "17:00",
        daysOfWeek: [1, 2, 3],
        priority: 10,
        isActive: true,
      }),
    });

    expect(response.status).toBe(422);
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
        displayId,
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

  test("POST /schedules returns 409 when schedule overlaps on same display", async () => {
    const { app, issueToken } = await makeApp(["schedules:create"]);
    const token = await issueToken();

    const first = await app.request("/schedules", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Morning",
        playlistId,
        displayId,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        startTime: "08:00",
        endTime: "10:00",
        daysOfWeek: [1],
        priority: 10,
        isActive: true,
      }),
    });
    expect(first.status).toBe(201);

    const conflict = await app.request("/schedules", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Conflict",
        playlistId,
        displayId,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        startTime: "09:00",
        endTime: "11:00",
        daysOfWeek: [1],
        priority: 10,
        isActive: true,
      }),
    });

    expect(conflict.status).toBe(409);
  });

  test("PATCH /schedules/:id returns 409 when update creates overlap", async () => {
    const { app, issueToken } = await makeApp([
      "schedules:create",
      "schedules:update",
      "schedules:read",
    ]);
    const token = await issueToken();

    const first = await app.request("/schedules", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Morning",
        playlistId,
        displayId,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        startTime: "08:00",
        endTime: "10:00",
        daysOfWeek: [1],
        priority: 10,
        isActive: true,
      }),
    });
    expect(first.status).toBe(201);

    const second = await app.request("/schedules", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Midday",
        playlistId,
        displayId,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        startTime: "11:00",
        endTime: "12:00",
        daysOfWeek: [1],
        priority: 10,
        isActive: true,
      }),
    });
    expect(second.status).toBe(201);

    const schedulesResponse = await app.request("/schedules", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const schedules = await parseJson<{
      data: Array<{ id: string; name: string }>;
    }>(schedulesResponse);
    const firstSchedule = schedules.data.find(
      (item) => item.name === "Morning",
    );
    const secondSchedule = schedules.data.find(
      (item) => item.name === "Midday",
    );

    expect(firstSchedule).toBeDefined();
    expect(firstSchedule?.id).toBeDefined();
    expect(secondSchedule).toBeDefined();
    expect(secondSchedule?.id).toBeDefined();

    const conflict = await app.request(`/schedules/${secondSchedule?.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startTime: "09:30",
        endTime: "11:30",
      }),
    });

    expect(conflict.status).toBe(409);
  });
});
