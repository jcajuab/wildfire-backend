import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { type ContentRecord } from "#/application/ports/content";
import { createContentHttpModule } from "#/bootstrap/http/modules";
import { Permission } from "#/domain/rbac/permission";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { createContentRouter } from "#/interfaces/http/routes/content";

const tokenIssuer = new JwtTokenIssuer({ secret: "test-secret" });
const parseJson = async <T>(response: Response) => (await response.json()) as T;

const makeRepository = () => {
  const records: ContentRecord[] = [];

  return {
    records,
    repository: {
      create: async (input: Omit<ContentRecord, "createdAt">) => {
        const record: ContentRecord = {
          ...input,
          createdAt: "2025-01-01T00:00:00.000Z",
        };
        records.push(record);
        return record;
      },
      findById: async (id: string) =>
        records.find((item) => item.id === id) ?? null,
      findByIdForOwner: async (id: string, ownerId: string) =>
        records.find((item) => item.id === id && item.ownerId === ownerId) ??
        null,
      findByIds: async (ids: string[]) =>
        records.filter((item) => ids.includes(item.id)),
      findByIdsForOwner: async (ids: string[], ownerId: string) =>
        records.filter(
          (item) => ids.includes(item.id) && item.ownerId === ownerId,
        ),
      list: async ({ offset, limit }: { offset: number; limit: number }) => ({
        items: records.slice(offset, offset + limit),
        total: records.length,
      }),
      listForOwner: async ({
        ownerId,
        offset,
        limit,
      }: {
        ownerId: string;
        offset: number;
        limit: number;
      }) => {
        const owned = records.filter((r) => r.ownerId === ownerId);
        return {
          items: owned.slice(offset, offset + limit),
          total: owned.length,
        };
      },
      delete: async (id: string) => {
        const index = records.findIndex((item) => item.id === id);
        if (index === -1) return false;
        records.splice(index, 1);
        return true;
      },
      deleteForOwner: async (id: string, ownerId: string) => {
        const index = records.findIndex(
          (item) => item.id === id && item.ownerId === ownerId,
        );
        if (index === -1) return false;
        records.splice(index, 1);
        return true;
      },
      update: async (
        id: string,
        input: Partial<
          Pick<
            ContentRecord,
            | "title"
            | "status"
            | "fileKey"
            | "thumbnailKey"
            | "type"
            | "mimeType"
            | "fileSize"
            | "width"
            | "height"
            | "duration"
            | "checksum"
          >
        >,
      ) => {
        const record = records.find((item) => item.id === id);
        if (!record) return null;
        Object.assign(record, input);
        return record;
      },
      updateForOwner: async (
        id: string,
        ownerId: string,
        input: Partial<ContentRecord>,
      ) => {
        const record = records.find(
          (item) => item.id === id && item.ownerId === ownerId,
        );
        if (!record) return null;
        Object.assign(record, input);
        return record;
      },
    },
  };
};

const makeApp = async (permissions: string[]) => {
  const app = new Hono();
  const { records, repository } = makeRepository();
  const storage = {
    ensureBucketExists: async () => {},
    upload: async () => {},
    download: async () => new Uint8Array(),
    delete: async () => {},
    getPresignedDownloadUrl: async ({
      key,
      expiresInSeconds: _expiresInSeconds,
      responseContentDisposition,
    }: {
      key: string;
      expiresInSeconds: number;
      responseContentDisposition?: string;
    }) =>
      `https://example.com/${key}${
        responseContentDisposition
          ? `?response-content-disposition=${encodeURIComponent(
              responseContentDisposition,
            )}`
          : ""
      }`,
    checkConnectivity: async () => ({ ok: true }),
  };
  const userRepository = {
    list: async () => [],
    findById: async (id: string) => ({
      id,
      username: "user",
      email: "user@example.com",
      name: "User",
      isActive: true,
    }),
    findByIds: async (ids: string[]) =>
      ids.map((id) => ({
        id,
        username: "user",
        email: "user@example.com",
        name: "User",
        isActive: true,
      })),
    findByUsername: async () => null,
    findByEmail: async () => null,
    create: async () => {
      throw new Error("not needed in test");
    },
    update: async () => null,
    delete: async () => false,
  };
  const authorizationRepository = {
    findPermissionsForUser: async () =>
      permissions.map((permission) => Permission.parse(permission)),
    isAdminUser: async () => false,
  };
  const authSessionRepository = {
    create: async () => {},
    extendExpiry: async () => {},
    revokeById: async () => {},
    revokeAllForUser: async () => {},
    isActive: async () => true,
    isOwnedByUser: async () => true,
    findBySessionId: async (sessionId: string) => ({
      id: sessionId,
      userId: "user-1",
      familyId: "family-1",
      currentJti: sessionId,
      previousJti: null,
      previousJtiExpiresAt: null,
      expiresAt: new Date(Date.now() + 3600 * 1000),
    }),
    updateCurrentJtiOptimistic: async () => false,
    revokeByFamilyId: async () => 0,
  };

  const router = createContentRouter(
    createContentHttpModule({
      jwtSecret: "test-secret",
      authSessionRepository,
      authSessionCookieName: "wildfire_session_token",
      maxUploadBytes: 5 * 1024 * 1024,
      videoMaxUploadBytes: 5 * 1024 * 1024,
      downloadUrlExpiresInSeconds: 3600,
      thumbnailUrlExpiresInSeconds: 3600,
      repositories: {
        contentRepository: repository,
        contentIngestionJobRepository: {
          create: async (input: {
            id: string;
            contentId: string;
            operation: "UPLOAD" | "REPLACE";
            status: "QUEUED" | "PROCESSING" | "SUCCEEDED" | "FAILED";
            ownerId: string;
            errorMessage?: string | null;
          }) => ({
            id: input.id,
            contentId: input.contentId,
            operation: input.operation,
            status: input.status,
            errorMessage: input.errorMessage ?? null,
            ownerId: input.ownerId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            startedAt: null,
            completedAt: null,
          }),
          findById: async () => null,
          update: async () => null,
        },
        scheduleRepository: {
          list: async () => [],
          listByDisplay: async () => [],
          listByPlaylistId: async () => [],
          listByContentId: async () => [],
          findById: async () => null,
          create: async () => {
            throw new Error("not needed in test");
          },
          update: async () => null,
          delete: async () => false,
          countByPlaylistId: async () => 0,
          countByContentId: async () => 0,
        },
        userRepository,
        authorizationRepository,
      },
      storage,
      contentIngestionQueue: {
        enqueue: async () => {},
      },
      contentMetadataExtractor: {
        extract: async () => ({ width: 1366, height: 768, duration: null }),
      },
      contentThumbnailGenerator: {
        generate: async () => null,
      },
      contentJobEventPublisher: {
        publish: () => {},
      },
      contentJobEventSubscription: {
        subscribe: () => () => {},
      },
      displayEventPublisher: {
        publish: () => {},
      },
      pdfCropSessionStore: {
        save: async () => {},
        findById: async () => null,
        delete: async () => {},
      },
      pdfPageExtractor: {
        extract: async () => ({ pageCount: 1, pages: [] }),
      },
      pdfCropRenderer: {
        renderCrop: async () => new Uint8Array(),
      },
    }),
  );
  app.route("/content", router);

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

  return { app, issueToken, records };
};

describe("Content routes", () => {
  test("POST /content uploads content", async () => {
    const { app, issueToken } = await makeApp(["content:create"]);
    const token = await issueToken();
    const form = new FormData();
    form.set("title", "Welcome");
    form.set(
      "file",
      new File([new TextEncoder().encode("hello")], "banner.png", {
        type: "image/png",
      }),
    );

    const response = await app.request("/content", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    expect(response.status).toBe(202);
    const body = await parseJson<{
      data: { content: { id: string; title: string }; job: { id: string } };
    }>(response);
    expect(body.data.content.title).toBe("Welcome");
    expect(response.headers.get("Location")).toBe(
      `/v1/content-jobs/${body.data.job.id}`,
    );
  });

  test("GET /content returns list", async () => {
    const { app, issueToken, records } = await makeApp(["content:read"]);
    const token = await issueToken();
    records.push({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Poster",
      type: "IMAGE",
      status: "READY",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const response = await app.request("/content", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      data: unknown[];
      meta: {
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
      };
    }>(response);
    expect(body.data).toHaveLength(1);
  });

  test("GET /content/options returns filtered content options", async () => {
    const { app, issueToken, records } = await makeApp(["content:read"]);
    const token = await issueToken();
    records.push({
      id: "flash-1",
      title: "Critical Alert",
      type: "FLASH",
      status: "READY",
      fileKey: "content/flash/flash-1",
      checksum: "flash-1",
      mimeType: "text/plain",
      fileSize: 1,
      width: null,
      height: null,
      duration: null,
      flashMessage: "Alert",
      flashTone: "CRITICAL",
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const response = await app.request(
      "/content/options?type=FLASH&status=READY",
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    expect(response.status).toBe(200);
    const body = await parseJson<{
      data: Array<{ id: string; title: string; type: string }>;
    }>(response);
    expect(body.data).toEqual([
      expect.objectContaining({
        id: "flash-1",
        title: "Critical Alert",
        type: "FLASH",
      }),
    ]);
  });

  test("GET /content/:id/file returns download URL", async () => {
    const { app, issueToken, records } = await makeApp(["content:read"]);
    const token = await issueToken();
    records.push({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Poster",
      type: "IMAGE",
      status: "READY",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const response = await app.request(
      "/content/11111111-1111-4111-8111-111111111111/file",
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    expect(response.status).toBe(200);
    const body = await parseJson<{ data: { downloadUrl: string } }>(response);
    expect(body.data.downloadUrl).toContain(
      "content/images/11111111-1111-4111-8111-111111111111.png",
    );
    expect(body.data.downloadUrl).toContain("response-content-disposition=");
  });

  test("GET /content/:id/file returns 403 without content:read", async () => {
    const { app, issueToken, records } = await makeApp(["content:update"]);
    const token = await issueToken();
    records.push({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Poster",
      type: "IMAGE",
      status: "READY",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const response = await app.request(
      "/content/11111111-1111-4111-8111-111111111111/file",
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    expect(response.status).toBe(403);
  });

  test("returns 401 without token", async () => {
    const { app } = await makeApp(["content:read"]);

    const response = await app.request("/content");
    expect(response.status).toBe(401);
  });

  test("returns 401 for invalid token payload", async () => {
    const { app } = await makeApp(["content:read"]);
    const token = await sign({ sub: 123 }, "test-secret");

    const response = await app.request("/content", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(401);
  });

  test("returns 403 without permission", async () => {
    const { app, issueToken } = await makeApp([]);
    const token = await issueToken();

    const response = await app.request("/content", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(403);
  });

  test("PATCH /content/:id updates content title", async () => {
    const { app, issueToken, records } = await makeApp(["content:update"]);
    const token = await issueToken();
    records.push({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Old Title",
      type: "IMAGE",
      status: "READY",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const response = await app.request(
      "/content/11111111-1111-4111-8111-111111111111",
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: "New Title" }),
      },
    );

    expect(response.status).toBe(200);
    const body = await parseJson<{ data: { id: string; title: string } }>(
      response,
    );
    expect(body.data.title).toBe("New Title");
  });

  test("PATCH /content/:id updates text content fields", async () => {
    const { app, issueToken, records } = await makeApp(["content:update"]);
    const token = await issueToken();
    records.push({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Rich Text",
      type: "TEXT",
      status: "READY",
      fileKey: "content/text/11111111-1111-4111-8111-111111111111.json",
      checksum: "abc",
      mimeType: "application/json",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      textJsonContent:
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Old text"}]}]}',
      textHtmlContent: "<p>Old text</p>",
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const nextTextJsonContent =
      '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Updated text"}]}]}';
    const nextTextHtmlContent = "<p>Updated text</p>";
    const response = await app.request(
      "/content/11111111-1111-4111-8111-111111111111",
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          textJsonContent: nextTextJsonContent,
          textHtmlContent: nextTextHtmlContent,
        }),
      },
    );

    expect(response.status).toBe(200);
    const body = await parseJson<{
      data: {
        id: string;
        textJsonContent: string | null;
        textHtmlContent: string | null;
      };
    }>(response);
    expect(body.data.textJsonContent).toBe(nextTextJsonContent);
    expect(body.data.textHtmlContent).toBe(nextTextHtmlContent);
  });

  test("PATCH /content/:id rejects status-only updates", async () => {
    const { app, issueToken, records } = await makeApp(["content:update"]);
    const token = await issueToken();
    records.push({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Status Test",
      type: "IMAGE",
      status: "READY",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const response = await app.request(
      "/content/11111111-1111-4111-8111-111111111111",
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "READY" }),
      },
    );

    expect(response.status).toBe(422);
  });

  test("PATCH /content/:id returns 404 for missing content", async () => {
    const { app, issueToken } = await makeApp(["content:update"]);
    const token = await issueToken();

    const response = await app.request(
      "/content/11111111-1111-4111-8111-111111111111",
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: "New Title" }),
      },
    );

    expect(response.status).toBe(404);
  });

  test("PATCH /content/:id returns 403 without permission", async () => {
    const { app, issueToken } = await makeApp([]);
    const token = await issueToken();

    const response = await app.request(
      "/content/11111111-1111-4111-8111-111111111111",
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: "New Title" }),
      },
    );

    expect(response.status).toBe(403);
  });

  test("PUT /content/:id/file replaces content file", async () => {
    const { app, issueToken, records } = await makeApp(["content:update"]);
    const token = await issueToken();
    const id = "11111111-1111-4111-8111-111111111111";
    records.push({
      id,
      title: "Old Image",
      type: "IMAGE",
      status: "READY",
      fileKey: `content/images/${id}.png`,
      checksum: "old",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const form = new FormData();
    form.set(
      "file",
      new File([new TextEncoder().encode("video")], "clip.mp4", {
        type: "video/mp4",
      }),
    );
    form.set("title", "New Video");

    const response = await app.request(`/content/${id}/file`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    expect(response.status).toBe(202);
    const body = await parseJson<{
      data: {
        content: {
          title: string;
          type: string;
          status: string;
          mimeType: string;
        };
        job: { id: string };
      };
    }>(response);
    expect(body.data.content.title).toBe("New Video");
    expect(body.data.content.type).toBe("VIDEO");
    expect(body.data.content.status).toBe("PROCESSING");
    expect(body.data.content.mimeType).toBe("video/mp4");
    expect(response.headers.get("Location")).toBe(
      `/v1/content-jobs/${body.data.job.id}`,
    );
  });

  test("PUT /content/:id/file returns 409 when content is in use", async () => {
    const { app, issueToken, records } = await makeApp(["content:update"]);
    const token = await issueToken();
    const id = "11111111-1111-4111-8111-111111111111";
    records.push({
      id,
      title: "In Use",
      type: "IMAGE",
      status: "PROCESSING",
      fileKey: `content/images/${id}.png`,
      checksum: "old",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const form = new FormData();
    form.set(
      "file",
      new File([new TextEncoder().encode("hello")], "poster.png", {
        type: "image/png",
      }),
    );

    const response = await app.request(`/content/${id}/file`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    expect(response.status).toBe(409);
  });
});
