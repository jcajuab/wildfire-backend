import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createSchedulesHttpModule } from "#/bootstrap/http/modules";
import { Permission } from "#/domain/rbac/permission";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { createSchedulesRouter } from "#/interfaces/http/routes/schedules.route";

const tokenIssuer = new JwtTokenIssuer({ secret: "test-secret" });
const parseJson = async <T>(response: Response) => (await response.json()) as T;
const playlistId = "b2c4a3f1-6b18-4f90-9d9b-9e1a2f0d9d45";
const displayId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const authSessionRepository = {
  create: async () => {},
  extendExpiry: async () => {},
  revokeById: async () => {},
  revokeAllForUser: async () => {},
  isActive: async () => true,
  isOwnedByUser: async () => true,
};

const makeApp = async (
  permissions: string[],
  options?: {
    createScheduleError?: Error;
    failOnBroadWindowRead?: boolean;
    schedules?: Array<{
      id: string;
      name: string;
      kind: "PLAYLIST" | "FLASH";
      playlistId: string | null;
      contentId: string | null;
      displayId: string;
      startDate?: string;
      endDate?: string;
      startTime: string;
      endTime: string;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    }>;
  },
) => {
  const app = new Hono();
  const schedules = [...(options?.schedules ?? [])];
  const playlists = [
    {
      id: playlistId,
      name: "Morning",
      description: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  ];
  const displays = [
    {
      id: displayId,
      name: "Lobby",
      slug: "display-1",
      status: "READY" as const,
      location: null,
      screenWidth: 1366,
      screenHeight: 768,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  ];

  const router = createSchedulesRouter(
    createSchedulesHttpModule({
      jwtSecret: "test-secret",
      authSessionRepository,
      authSessionCookieName: "wildfire_session",
      timezone: "UTC",
      repositories: {
        scheduleRepository: {
          list: async () => {
            if (options?.failOnBroadWindowRead) {
              throw new Error("scheduleRepository.list should not be used");
            }
            return [...schedules];
          },
          listByDisplay: async (displayId: string) =>
            schedules.filter((schedule) => schedule.displayId === displayId),
          listByDisplayIds: async (displayIds: string[]) =>
            schedules.filter((schedule) =>
              displayIds.includes(schedule.displayId),
            ),
          findById: async (id: string) =>
            schedules.find((schedule) => schedule.id === id) ?? null,
          listWindow: async (input: {
            from: string;
            to: string;
            displayIds?: readonly string[];
          }) =>
            schedules
              .filter((schedule) => {
                if (
                  input.displayIds &&
                  input.displayIds.length > 0 &&
                  !input.displayIds.includes(schedule.displayId)
                ) {
                  return false;
                }
                return (
                  (schedule.startDate ?? "1970-01-01") <= input.to &&
                  (schedule.endDate ?? "2099-12-31") >= input.from
                );
              })
              .sort((left, right) => {
                const dateDelta = (left.startDate ?? "").localeCompare(
                  right.startDate ?? "",
                );
                if (dateDelta !== 0) {
                  return dateDelta;
                }
                const timeDelta = left.startTime.localeCompare(right.startTime);
                if (timeDelta !== 0) {
                  return timeDelta;
                }
                return left.name.localeCompare(right.name);
              }),
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
              kind: input.kind ?? "PLAYLIST",
              contentId: input.contentId ?? null,
            };
            schedules.push(record);
            return record;
          },
          update: async (id, input) => {
            const index = schedules.findIndex((schedule) => schedule.id === id);
            if (index === -1) return null;
            const current = schedules[index];
            if (!current) return null;
            const next = {
              ...current,
              ...input,
              kind: input.kind ?? current.kind,
              contentId: input.contentId ?? current.contentId,
            };
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
          listByPlaylistId: async (playlistId: string) =>
            schedules.filter((schedule) => schedule.playlistId === playlistId),
        },
        playlistRepository: {
          list: async () => [...playlists],
          listForOwner: async (ownerId: string) =>
            playlists.filter((p) => p.ownerId === ownerId),
          listPageForOwner: async ({
            ownerId,
            offset,
            limit,
          }: {
            ownerId: string;
            offset: number;
            limit: number;
          }) => {
            const owned = playlists.filter((p) => p.ownerId === ownerId);
            return {
              items: owned.slice(offset, offset + limit),
              total: owned.length,
            };
          },
          listPage: async ({ offset, limit }) => ({
            items: playlists.slice(offset, offset + limit),
            total: playlists.length,
          }),
          findByIds: async (ids: string[]) =>
            playlists.filter((playlist) => ids.includes(playlist.id)),
          findByIdsForOwner: async (ids: string[], ownerId: string) =>
            playlists.filter(
              (p) => ids.includes(p.id) && p.ownerId === ownerId,
            ),
          findById: async (id: string) =>
            playlists.find((playlist) => playlist.id === id) ?? null,
          findByIdForOwner: async (id: string, ownerId: string) =>
            playlists.find((p) => p.id === id && p.ownerId === ownerId) ?? null,
          create: async () => {
            throw new Error("not used");
          },
          update: async () => null,
          updateForOwner: async () => null,
          updateStatus: async () => undefined,
          delete: async () => false,
          deleteForOwner: async () => false,
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
          listPage: async () => ({
            items: [...displays],
            total: displays.length,
            page: 1,
            pageSize: displays.length || 1,
          }),
          findByIds: async (ids: string[]) =>
            displays.filter((display) => ids.includes(display.id)),
          findById: async (id: string) =>
            displays.find((display) => display.id === id) ?? null,
          findBySlug: async () => null,
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
          delete: async (_id: string) => false,
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
          findByIdForOwner: async () => null,
          findByIds: async () => [],
          findByIdsForOwner: async () => [],
          list: async () => ({ items: [], total: 0 }),
          listForOwner: async () => ({ items: [], total: 0 }),
          update: async () => null,
          updateForOwner: async () => null,
          delete: async () => false,
          deleteForOwner: async () => false,
        },
      },
      displayEventPublisher: {
        publish: () => {},
      },
    }),
  );

  app.route("/schedules", router);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const issueToken = async () =>
    tokenIssuer.issueToken({
      subject: "user-1",
      username: "user",
      email: "user@example.com",
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + 3600,
      sessionId: crypto.randomUUID(),
      issuer: undefined,
    });

  return { app, issueToken };
};

describe("Schedules routes", () => {
  test("GET /schedules returns list with permission", async () => {
    const { app, issueToken } = await makeApp([
      "schedules:read",
      "schedules:create",
    ]);
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
        pageSize: number;
        totalPages: number;
      };
    }>(response);
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.meta.total).toBe("number");
    expect(body.meta.page).toBe(1);
    expect(body.meta.pageSize).toBe(50);
  });

  test("GET /schedules/window returns schedules intersecting the requested range", async () => {
    const { app, issueToken } = await makeApp(["schedules:read"], {
      schedules: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          name: "Morning",
          kind: "PLAYLIST",
          playlistId,
          contentId: null,
          displayId,
          startDate: "2027-01-02",
          endDate: "2027-01-05",
          startTime: "08:00",
          endTime: "10:00",
          isActive: true,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    });
    const token = await issueToken();

    const response = await app.request(
      `/schedules/window?from=2027-01-03&to=2027-01-03&displayIds=${displayId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    expect(response.status).toBe(200);
    const body = await parseJson<{ data: Array<{ name: string }> }>(response);
    expect(body.data.map((schedule) => schedule.name)).toEqual(["Morning"]);
  });

  test("GET /schedules/window returns 422 when from is after to", async () => {
    const { app, issueToken } = await makeApp(["schedules:read"]);
    const token = await issueToken();

    const response = await app.request(
      `/schedules/window?from=2027-01-07&to=2027-01-03&displayIds=${displayId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    expect(response.status).toBe(422);
  });

  test("GET /schedules/window uses repository-backed window query path", async () => {
    const { app, issueToken } = await makeApp(["schedules:read"], {
      failOnBroadWindowRead: true,
    });
    const token = await issueToken();

    const response = await app.request(
      `/schedules/window?from=2027-01-01&to=2027-01-07&displayIds=${displayId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    expect(response.status).toBe(200);
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
        kind: "PLAYLIST",
        playlistId,
        contentId: null,
        displayId,
        startDate: "2027-01-01",
        endDate: "2027-12-31",
        startTime: "08:00",
        endTime: "17:00",
        isActive: true,
      }),
    });

    expect(response.status).toBe(201);
    const body = await parseJson<{ data: { id: string; name: string } }>(
      response,
    );
    expect(typeof body.data.id).toBe("string");
    expect(body.data.name).toBe("Morning");
    expect(response.headers.get("Location")).toBe(`/schedules/${body.data.id}`);
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
        kind: "PLAYLIST",
        playlistId: "0e2c9b1e-7c1a-4b4d-8c2e-7b0a2f5f6d8c",
        contentId: null,
        displayId,
        startDate: "2027-01-01",
        endDate: "2027-12-31",
        startTime: "08:00",
        endTime: "17:00",
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
        kind: "PLAYLIST",
        playlistId,
        contentId: null,
        displayId,
        startDate: "2027-01-01",
        endDate: "2027-12-31",
        startTime: "99:00",
        endTime: "17:00",
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
        kind: "PLAYLIST",
        playlistId,
        contentId: null,
        displayId,
        startDate: "2027-01-01",
        endDate: "2027-12-31",
        startTime: "08:00",
        endTime: "17:00",
        isActive: true,
      }),
    });

    expect(response.status).toBe(500);
  });

  test("POST /schedules allows PLAYLIST overlaps on same display (virtual merge)", async () => {
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
        kind: "PLAYLIST",
        playlistId,
        contentId: null,
        displayId,
        startDate: "2027-01-01",
        endDate: "2027-12-31",
        startTime: "08:00",
        endTime: "10:00",
        isActive: true,
      }),
    });
    expect(first.status).toBe(201);

    const overlapping = await app.request("/schedules", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Overlapping",
        kind: "PLAYLIST",
        playlistId,
        contentId: null,
        displayId,
        startDate: "2027-01-01",
        endDate: "2027-12-31",
        startTime: "09:00",
        endTime: "11:00",
        isActive: true,
      }),
    });

    // PLAYLIST overlaps are now allowed - playlists merge at runtime
    expect(overlapping.status).toBe(201);
  });

  test("PATCH /schedules/:id allows PLAYLIST overlap update (virtual merge)", async () => {
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
        kind: "PLAYLIST",
        playlistId,
        contentId: null,
        displayId,
        startDate: "2027-01-01",
        endDate: "2027-12-31",
        startTime: "08:00",
        endTime: "10:00",
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
        kind: "PLAYLIST",
        playlistId,
        contentId: null,
        displayId,
        startDate: "2027-01-01",
        endDate: "2027-12-31",
        startTime: "11:00",
        endTime: "12:00",
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
    const secondSchedule = schedules.data.find(
      (item) => item.name === "Midday",
    );

    expect(secondSchedule).toBeDefined();
    expect(secondSchedule?.id).toBeDefined();

    const overlap = await app.request(`/schedules/${secondSchedule?.id}`, {
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

    // PLAYLIST overlaps are now allowed - playlists merge at runtime
    expect(overlap.status).toBe(200);
  });
});
