import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { type ContentRecord } from "#/application/ports/content";
import { Permission } from "#/domain/rbac/permission";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { createContentRouter } from "#/interfaces/http/routes/content.route";

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
      findByIds: async (ids: string[]) =>
        records.filter((item) => ids.includes(item.id)),
      list: async ({ offset, limit }: { offset: number; limit: number }) => ({
        items: records.slice(offset, offset + limit),
        total: records.length,
      }),
      delete: async (id: string) => {
        const index = records.findIndex((item) => item.id === id);
        if (index === -1) return false;
        records.splice(index, 1);
        return true;
      },
      update: async (
        id: string,
        input: Partial<Pick<ContentRecord, "title">>,
      ) => {
        const record = records.find((item) => item.id === id);
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
    upload: async () => {},
    delete: async () => {},
    getPresignedDownloadUrl: async ({ key }: { key: string }) =>
      `https://example.com/${key}`,
  };
  const userRepository = {
    list: async () => [],
    findById: async (id: string) => ({
      id,
      email: "user@example.com",
      name: "User",
      isActive: true,
    }),
    findByIds: async (ids: string[]) =>
      ids.map((id) => ({
        id,
        email: "user@example.com",
        name: "User",
        isActive: true,
      })),
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
  };

  const router = createContentRouter({
    jwtSecret: "test-secret",
    maxUploadBytes: 5 * 1024 * 1024,
    downloadUrlExpiresInSeconds: 3600,
    repositories: {
      contentRepository: repository,
      userRepository,
      authorizationRepository,
    },
    storage,
  });
  app.route("/content", router);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const issueToken = async () =>
    tokenIssuer.issueToken({
      subject: "user-1",
      email: "user@example.com",
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + 3600,
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

    expect(response.status).toBe(201);
    const body = await parseJson<{ id: string; title: string }>(response);
    expect(body.title).toBe("Welcome");
  });

  test("GET /content returns list", async () => {
    const { app, issueToken, records } = await makeApp(["content:read"]);
    const token = await issueToken();
    records.push({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Poster",
      type: "IMAGE",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      createdById: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const response = await app.request("/content", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{ items: unknown[] }>(response);
    expect(body.items).toHaveLength(1);
  });

  test("GET /content/:id/file returns download URL", async () => {
    const { app, issueToken, records } = await makeApp(["content:read"]);
    const token = await issueToken();
    records.push({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Poster",
      type: "IMAGE",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      createdById: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const response = await app.request(
      "/content/11111111-1111-4111-8111-111111111111/file",
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    expect(response.status).toBe(200);
    const body = await parseJson<{ downloadUrl: string }>(response);
    expect(body.downloadUrl).toContain(
      "content/images/11111111-1111-4111-8111-111111111111.png",
    );
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
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      createdById: "user-1",
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
    const body = await parseJson<{ id: string; title: string }>(response);
    expect(body.title).toBe("New Title");
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
});
