import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { type ContentRecord } from "#/application/ports/content";
import { createPlaylistsHttpModule } from "#/bootstrap/http/modules";
import { Permission } from "#/domain/rbac/permission";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { createPlaylistsRouter } from "#/interfaces/http/routes/playlists";

const tokenIssuer = new JwtTokenIssuer({ secret: "test-secret" });
const parseJson = async <T>(response: Response) => (await response.json()) as T;
const playlistId = "b2c4a3f1-6b18-4f90-9d9b-9e1a2f0d9d45";
const contentId = "9c7b2f9a-2f5d-4bd9-9c9e-1f0c1d9b8c7a";
const contentId2 = "e2d6b6fc-f0f5-437f-8333-03f4ef8f7d6a";
const contentId3 = "d9ca5e43-4c20-4f8f-b634-d9e35b7f208d";
const contentId4 = "4b5633b2-4f4f-4f0b-a76d-f60c4af0f9bf";
const contentId5 = "f28ed527-7e2b-4b66-928a-f8df441a32f3";
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
    ownerId: string;
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
      status: "READY",
      fileKey: "content/images/a.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 100,
      width: 10,
      height: 10,
      duration: null,
      thumbnailKey: "content/thumbs/a.png",
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: contentId2,
      title: "Slides",
      type: "IMAGE",
      status: "READY",
      fileKey: "content/images/b.png",
      checksum: "def",
      mimeType: "image/png",
      fileSize: 100,
      width: 10,
      height: 10,
      duration: null,
      thumbnailKey: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: contentId3,
      title: "Offer",
      type: "IMAGE",
      status: "READY",
      fileKey: "content/images/c.png",
      checksum: "ghi",
      mimeType: "image/png",
      fileSize: 100,
      width: 10,
      height: 10,
      duration: null,
      thumbnailKey: "content/thumbs/c.png",
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: contentId4,
      title: "Pricing",
      type: "IMAGE",
      status: "READY",
      fileKey: "content/images/d.png",
      checksum: "jkl",
      mimeType: "image/png",
      fileSize: 100,
      width: 10,
      height: 10,
      duration: null,
      thumbnailKey: "content/thumbs/d.png",
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: contentId5,
      title: "Goodbye",
      type: "IMAGE",
      status: "READY",
      fileKey: "content/images/e.png",
      checksum: "mno",
      mimeType: "image/png",
      fileSize: 100,
      width: 10,
      height: 10,
      duration: null,
      thumbnailKey: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  ];
  const storage = {
    ensureBucketExists: async () => {},
    upload: async (_input: {
      key: string;
      body: Uint8Array;
      contentType: string;
      contentLength: number;
    }) => {},
    delete: async (_key: string) => {},
    getPresignedDownloadUrl: async (input: {
      key: string;
      expiresInSeconds: number;
      responseContentDisposition?: string;
    }) => `https://cdn.example.com/${input.key}`,
  };

  const router = createPlaylistsRouter(
    createPlaylistsHttpModule({
      jwtSecret: "test-secret",
      authSessionRepository,
      authSessionCookieName: "wildfire_session",
      repositories: {
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
            playlists.filter((item) => ids.includes(item.id)),
          findByIdsForOwner: async (ids: string[], ownerId: string) =>
            playlists.filter(
              (p) => ids.includes(p.id) && p.ownerId === ownerId,
            ),
          findById: async (id: string) =>
            playlists.find((item) => item.id === id) ?? null,
          findByIdForOwner: async (id: string, ownerId: string) =>
            playlists.find((p) => p.id === id && p.ownerId === ownerId) ?? null,
          create: async (input) => {
            const record = {
              id: playlistId,
              name: input.name,
              description: input.description,
              status: "DRAFT" as const,
              ownerId: input.ownerId,
              createdAt: "2025-01-01T00:00:00.000Z",
              updatedAt: "2025-01-01T00:00:00.000Z",
            };
            playlists.push(record);
            return record;
          },
          update: async () => null,
          updateForOwner: async () => null,
          updateStatus: async () => undefined,
          delete: async () => false,
          deleteForOwner: async () => false,
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
          findByIdForOwner: async (id: string, ownerId: string) =>
            contents.find((c) => c.id === id && c.ownerId === ownerId) ?? null,
          findByIds: async (ids: string[]) =>
            contents.filter((content) => ids.includes(content.id)),
          findByIdsForOwner: async (ids: string[], ownerId: string) =>
            contents.filter((c) => ids.includes(c.id) && c.ownerId === ownerId),
          create: async () => {
            throw new Error("not used");
          },
          list: async () => ({ items: [], total: 0 }),
          listForOwner: async () => ({ items: [], total: 0 }),
          delete: async () => false,
          deleteForOwner: async () => false,
          update: async () => null,
          updateForOwner: async () => null,
        },
        userRepository: {
          list: async () => [],
          findById: async () =>
            options?.missingUser
              ? null
              : {
                  id: "user-1",
                  username: "user",
                  email: "user@example.com",
                  name: "User",
                  isActive: true,
                },
          findByIds: async () => [
            {
              id: "user-1",
              username: "user",
              email: "user@example.com",
              name: "User",
              isActive: true,
            },
          ],
          findByUsername: async () => null,
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
          isAdminUser: async () => false,
        },
        scheduleRepository: {
          list: async () => [],
          listByDisplay: async () => [],
          listByPlaylistId: async (id: string) =>
            options?.inUsePlaylistId === id
              ? [
                  {
                    id: "schedule-1",
                    name: "Morning",
                    kind: "PLAYLIST",
                    playlistId: id,
                    contentId: null,
                    displayId: "display-1",
                    startTime: "08:00",
                    endTime: "18:00",
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
        },
        displayRepository: {
          list: async () => [],
          listPage: async () => ({
            items: [],
            total: 0,
            page: 1,
            pageSize: 20,
          }),
          findByIds: async () => [],
          findById: async () => ({
            id: "display-1",
            name: "Lobby",
            slug: "display-1",
            status: "READY" as const,
            location: null,
            screenWidth: 1366,
            screenHeight: 768,
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
          }),
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
      },
      storage,
      thumbnailUrlExpiresInSeconds: 3600,
      displayEventPublisher: {
        publish: () => {},
      },
    }),
  );

  app.route("/playlists", router);

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

  return { app, issueToken, playlists, items, contents };
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
    expect(body.meta.pageSize).toBe(20);
  });

  test("GET /playlists returns first 3 previewItems in sequence order", async () => {
    const { app, issueToken, playlists, items } = await makeApp([
      "playlists:read",
    ]);
    playlists.push({
      id: playlistId,
      name: "Morning Loop",
      description: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    items.push(
      {
        id: "item-1",
        playlistId,
        contentId: contentId3,
        sequence: 30,
        duration: 10,
      },
      {
        id: "item-2",
        playlistId,
        contentId: contentId,
        sequence: 10,
        duration: 10,
      },
      {
        id: "item-3",
        playlistId,
        contentId: contentId2,
        sequence: 20,
        duration: 10,
      },
      {
        id: "item-4",
        playlistId,
        contentId: contentId4,
        sequence: 40,
        duration: 10,
      },
      {
        id: "item-5",
        playlistId,
        contentId: contentId5,
        sequence: 50,
        duration: 10,
      },
    );

    const token = await issueToken();
    const response = await app.request("/playlists", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      data: Array<{
        id: string;
        itemsCount: number;
        previewItems: Array<{
          id: string;
          sequence: number;
          content: { id: string; thumbnailUrl: string | null };
        }>;
        items?: unknown;
      }>;
    }>(response);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.items).toBeUndefined();
    expect(body.data[0]?.itemsCount).toBe(5);
    expect(body.data[0]?.previewItems).toHaveLength(3);
    expect(body.data[0]?.previewItems.map((item) => item.sequence)).toEqual([
      10, 20, 30,
    ]);
    expect(body.data[0]?.previewItems.map((item) => item.content.id)).toEqual([
      contentId,
      contentId2,
      contentId3,
    ]);
    expect(body.data[0]?.previewItems[0]?.content.thumbnailUrl).toBe(
      "https://cdn.example.com/content/thumbs/a.png",
    );
    expect(body.data[0]?.previewItems[1]?.content.thumbnailUrl).toBeNull();
  });

  test("GET /playlists returns empty previewItems for empty playlists", async () => {
    const { app, issueToken, playlists } = await makeApp(["playlists:read"]);
    playlists.push({
      id: playlistId,
      name: "Empty Loop",
      description: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    const token = await issueToken();
    const response = await app.request("/playlists", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      data: Array<{ id: string; itemsCount: number; previewItems: unknown[] }>;
    }>(response);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.itemsCount).toBe(0);
    expect(body.data[0]?.previewItems).toEqual([]);
  });

  test("GET /playlists fills previewItems from first 3 resolvable sequenced items", async () => {
    const { app, issueToken, playlists, items } = await makeApp([
      "playlists:read",
    ]);
    playlists.push({
      id: playlistId,
      name: "Resolvable Loop",
      description: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    items.push(
      {
        id: "item-1",
        playlistId,
        contentId: "missing-content-1",
        sequence: 10,
        duration: 10,
      },
      {
        id: "item-2",
        playlistId,
        contentId: "missing-content-2",
        sequence: 20,
        duration: 10,
      },
      {
        id: "item-3",
        playlistId,
        contentId,
        sequence: 30,
        duration: 10,
      },
      {
        id: "item-4",
        playlistId,
        contentId: contentId2,
        sequence: 40,
        duration: 10,
      },
      {
        id: "item-5",
        playlistId,
        contentId: contentId3,
        sequence: 50,
        duration: 10,
      },
    );

    const token = await issueToken();
    const response = await app.request("/playlists", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      data: Array<{
        id: string;
        itemsCount: number;
        previewItems: Array<{
          sequence: number;
          content: { id: string };
        }>;
      }>;
    }>(response);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.itemsCount).toBe(5);
    expect(body.data[0]?.previewItems).toHaveLength(3);
    expect(body.data[0]?.previewItems.map((item) => item.sequence)).toEqual([
      30, 40, 50,
    ]);
    expect(body.data[0]?.previewItems.map((item) => item.content.id)).toEqual([
      contentId,
      contentId2,
      contentId3,
    ]);
  });

  test("GET /playlists/:id includes content.thumbnailUrl in items", async () => {
    const { app, issueToken, playlists, items } = await makeApp([
      "playlists:read",
    ]);
    playlists.push({
      id: playlistId,
      name: "Detail Loop",
      description: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    items.push(
      {
        id: "item-1",
        playlistId,
        contentId,
        sequence: 1,
        duration: 10,
      },
      {
        id: "item-2",
        playlistId,
        contentId: contentId2,
        sequence: 2,
        duration: 10,
      },
    );

    const token = await issueToken();
    const response = await app.request(`/playlists/${playlistId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      data: {
        items: Array<{ content: { thumbnailUrl: string | null } }>;
      };
    }>(response);
    expect(body.data.items[0]?.content.thumbnailUrl).toBe(
      "https://cdn.example.com/content/thumbs/a.png",
    );
    expect(body.data.items[1]?.content.thumbnailUrl).toBeNull();
  });

  test("GET /playlists/options returns playlist options", async () => {
    const { app, issueToken } = await makeApp([
      "playlists:create",
      "playlists:read",
    ]);
    const token = await issueToken();

    await app.request("/playlists", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Lobby Loop",
        description: null,
      }),
    });

    const response = await app.request("/playlists/options", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{ data: Array<{ id: string; name: string }> }>(
      response,
    );
    expect(body.data).toEqual([
      expect.objectContaining({ id: playlistId, name: "Lobby Loop" }),
    ]);
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
    const json = await parseJson<{ data: { id: string } }>(response);
    expect(json.data.id).toBeDefined();
    expect(response.headers.get("Location")).toBe(`/playlists/${json.data.id}`);
  });

  test("POST /playlists returns 404 when owner is missing", async () => {
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
      ownerId: "user-1",
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
    const body = await parseJson<{ data: { id: string } }>(response);
    expect(body.data.id).toBeDefined();
    expect(response.headers.get("Location")).toBe(
      `/playlists/${playlistId}/items/${body.data.id}`,
    );
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
    const { app, issueToken, playlists } = await makeApp(["playlists:delete"], {
      inUsePlaylistId: playlistId,
    });
    playlists.push({
      id: playlistId,
      name: "Morning",
      description: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
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
    expect(body.error.code).toBe("playlist_in_use");
    expect(body.error.message).toContain("in use");
  });

  test("PATCH /playlists/:id/items/:itemId returns 422 for invalid payload", async () => {
    const { app, issueToken, playlists } = await makeApp(["playlists:update"]);
    playlists.push({
      id: playlistId,
      name: "Morning",
      description: null,
      ownerId: "user-1",
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

    expect(response.status).toBe(422);
  });

  test("POST /playlists/:id/items returns 500 on unexpected repository failure", async () => {
    const { app, issueToken, playlists } = await makeApp(["playlists:update"], {
      addPlaylistItemError: new Error("write failed"),
    });
    playlists.push({
      id: playlistId,
      name: "Morning",
      description: null,
      ownerId: "user-1",
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
