import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { type ContentRecord } from "#/application/ports/content";
import { Permission } from "#/domain/rbac/permission";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { createPlaylistsRouter } from "#/interfaces/http/routes/playlists.route";

const tokenIssuer = new JwtTokenIssuer({ secret: "test-secret" });
const parseJson = async <T>(response: Response) => (await response.json()) as T;
const playlistId = "b2c4a3f1-6b18-4f90-9d9b-9e1a2f0d9d45";
const contentId = "9c7b2f9a-2f5d-4bd9-9c9e-1f0c1d9b8c7a";

const makeApp = async (
  permissions: string[],
  options?: {
    missingUser?: boolean;
    addPlaylistItemError?: Error;
    /** When set, listByPlaylistId returns a schedule for this id (playlist in use). */
    inUsePlaylistId?: string;
  },
) => {
  const app = new Hono();
  const playlists: Array<{
    id: string;
    name: string;
    description: string | null;
    createdById: string;
    createdAt: string;
    updatedAt: string;
  }> = [];
  const items: Array<{
    id: string;
    playlistId: string;
    contentId: string;
    sequence: number;
    duration: number;
  }> = [];
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

  const router = createPlaylistsRouter({
    jwtSecret: "test-secret",
    repositories: {
      playlistRepository: {
        list: async () => [...playlists],
        listPage: async ({ offset, limit }) => ({
          items: playlists.slice(offset, offset + limit),
          total: playlists.length,
        }),
        findByIds: async (ids: string[]) =>
          playlists.filter((item) => ids.includes(item.id)),
        findById: async (id: string) =>
          playlists.find((item) => item.id === id) ?? null,
        create: async (input) => {
          const record = {
            id: playlistId,
            name: input.name,
            description: input.description,
            status: "DRAFT" as const,
            createdById: input.createdById,
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
          };
          playlists.push(record);
          return record;
        },
        update: async () => null,
        updateStatus: async () => undefined,
        delete: async () => false,
        listItems: async (playlistId: string) =>
          items.filter((item) => item.playlistId === playlistId),
        findItemById: async (id: string) =>
          items.find((item) => item.id === id) ?? null,
        countItemsByContentId: async (contentId: string) =>
          items.filter((item) => item.contentId === contentId).length,
        addItem: async (input) => {
          if (options?.addPlaylistItemError) {
            throw options.addPlaylistItemError;
          }
          const record = {
            id: `item-${items.length + 1}`,
            ...input,
          };
          items.push(record);
          return record;
        },
        updateItem: async () => null,
        reorderItems: async () => true,
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
        listPlaylistsReferencingContent: async () => [],
        delete: async () => false,
        update: async () => null,
      },
      userRepository: {
        list: async () => [],
        findById: async () =>
          options?.missingUser
            ? null
            : {
                id: "user-1",
                email: "user@example.com",
                name: "User",
                isActive: true,
              },
        findByIds: async () => [
          {
            id: "user-1",
            email: "user@example.com",
            name: "User",
            isActive: true,
          },
        ],
        findByEmail: async () => null,
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        delete: async () => false,
      },
      authorizationRepository: {
        findPermissionsForUser: async () =>
          permissions.map((permission) => Permission.parse(permission)),
      },
      scheduleRepository: {
        list: async () => [],
        listByDisplay: async () => [],
        listBySeries: async () => [],
        listByPlaylistId: async (id: string) =>
          options?.inUsePlaylistId === id
            ? [
                {
                  id: "schedule-1",
                  seriesId: "series-1",
                  name: "Morning",
                  playlistId: id,
                  displayId: "display-1",
                  startTime: "08:00",
                  endTime: "18:00",
                  dayOfWeek: 1,
                  priority: 10,
                  isActive: true,
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
        delete: async () => false,
        countByPlaylistId: async (id: string) =>
          options?.inUsePlaylistId === id ? 1 : 0,
        deleteBySeries: async () => 0,
      },
      displayRepository: {
        list: async () => [],
        findByIds: async () => [],
        findById: async () => ({
          id: "display-1",
          name: "Lobby",
          identifier: "AA:BB",
          location: null,
          screenWidth: 1366,
          screenHeight: 768,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }),
        findByIdentifier: async () => null,
        findByFingerprint: async () => null,
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        bumpRefreshNonce: async () => false,
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

  app.route("/playlists", router);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const issueToken = async () =>
    tokenIssuer.issueToken({
      subject: "user-1",
      email: "user@example.com",
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + 3600,
      issuer: undefined,
    });

  return { app, issueToken, playlists };
};

describe("Playlists routes", () => {
  test("GET /playlists returns list with permission", async () => {
    const { app, issueToken } = await makeApp(["playlists:read"]);
    const token = await issueToken();

    const response = await app.request("/playlists", {
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
    expect(body.pageSize).toBe(20);
  });

  test("POST /playlists creates playlist", async () => {
    const { app, issueToken } = await makeApp(["playlists:create"]);
    const token = await issueToken();

    const response = await app.request("/playlists", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Morning" }),
    });

    expect(response.status).toBe(201);
    const json = await parseJson<{ id: string }>(response);
    expect(json.id).toBeDefined();
  });

  test("POST /playlists returns 404 when creator is missing", async () => {
    const { app, issueToken } = await makeApp(["playlists:create"], {
      missingUser: true,
    });
    const token = await issueToken();

    const response = await app.request("/playlists", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Morning" }),
    });

    expect(response.status).toBe(404);
  });

  test("POST /playlists/:id/items adds item", async () => {
    const { app, issueToken, playlists } = await makeApp(["playlists:update"]);
    playlists.push({
      id: playlistId,
      name: "Morning",
      description: null,
      createdById: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    const token = await issueToken();

    const response = await app.request(`/playlists/${playlistId}/items`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contentId,
        sequence: 10,
        duration: 5,
      }),
    });

    expect(response.status).toBe(201);
  });

  test("DELETE /playlists/:id returns 404 when missing", async () => {
    const { app, issueToken } = await makeApp(["playlists:delete"]);
    const token = await issueToken();

    const response = await app.request(`/playlists/${playlistId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(404);
  });

  test("DELETE /playlists/:id returns 409 when playlist is in use", async () => {
    const { app, issueToken } = await makeApp(["playlists:delete"], {
      inUsePlaylistId: playlistId,
    });
    const token = await issueToken();

    const response = await app.request(`/playlists/${playlistId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(409);
    const body = await parseJson<{ error: { code: string; message: string } }>(
      response,
    );
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message).toContain("in use");
  });

  test("PATCH /playlists/:id/items/:itemId returns 400 for invalid payload", async () => {
    const { app, issueToken, playlists } = await makeApp(["playlists:update"]);
    playlists.push({
      id: playlistId,
      name: "Morning",
      description: null,
      createdById: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    const token = await issueToken();
    const response = await app.request(
      `/playlists/${playlistId}/items/11111111-1111-1111-1111-111111111111`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sequence: 0 }),
      },
    );

    expect(response.status).toBe(400);
  });

  test("POST /playlists/:id/items returns 500 on unexpected repository failure", async () => {
    const { app, issueToken, playlists } = await makeApp(["playlists:update"], {
      addPlaylistItemError: new Error("write failed"),
    });
    playlists.push({
      id: playlistId,
      name: "Morning",
      description: null,
      createdById: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    const token = await issueToken();

    const response = await app.request(`/playlists/${playlistId}/items`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contentId,
        sequence: 10,
        duration: 5,
      }),
    });

    expect(response.status).toBe(500);
  });
});
