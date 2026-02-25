import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { Permission } from "#/domain/rbac/permission";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { createAuditRouter } from "#/interfaces/http/routes/audit.route";

const tokenIssuer = new JwtTokenIssuer({ secret: "test-secret" });
const parseJson = async <T>(response: Response) => (await response.json()) as T;

const buildAuditEvent = (
  id: string,
  overrides: Partial<{
    occurredAt: string;
    requestId: string | null;
    action: string;
    route: string | null;
    method: string;
    path: string;
    status: number;
    actorId: string | null;
    actorType: "user" | "device" | null;
    resourceId: string | null;
    resourceType: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    actorName: string | null;
    actorEmail: string | null;
  }> = {},
) => ({
  id,
  occurredAt: "2026-01-01T00:00:00.000Z",
  requestId: "req-1",
  action: "rbac.user.update",
  route: "/users/:id",
  method: "PATCH",
  path: `/users/${id}`,
  status: 200,
  actorId: "user-1",
  actorType: "user" as const,
  resourceId: id,
  resourceType: "user",
  ipAddress: "127.0.0.1",
  userAgent: "test-agent",
  metadataJson: null,
  actorName: "Admin User",
  actorEmail: "admin@example.com",
  ...overrides,
});

const mockUserRepository = {
  findByIds: async (ids: string[]) =>
    ids
      .filter((id) => id === "user-1")
      .map((id) => ({
        id,
        email: "admin@example.com",
        name: "Admin User",
        isActive: true,
      })),
  list: async () => [],
  findById: async () => null,
  findByEmail: async () => null,
  create: async () => ({ id: "", email: "", name: "", isActive: true }),
  update: async () => null,
  delete: async () => false,
};

const mockDeviceRepository = {
  findByIds: async (ids: string[]) =>
    ids
      .filter((id) => id === "device-1")
      .map((id) => ({
        id,
        name: "Lobby Display",
        identifier: "lobby-1",
        location: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      })),
  list: async () => [],
  findById: async () => null,
  findByIdentifier: async () => null,
  findByFingerprint: async () => null,
  create: async () => ({
    id: "",
    name: "",
    identifier: "",
    location: null,
    createdAt: "",
    updatedAt: "",
  }),
  update: async () => null,
  bumpRefreshNonce: async () => false,
};

const makeApp = async (permissions: string[]) => {
  const listCalls: unknown[] = [];
  const countCalls: unknown[] = [];

  const auditEventRepository = {
    create: async () => buildAuditEvent("event-created"),
    list: async (query: unknown) => {
      listCalls.push(query);
      return [buildAuditEvent("event-1")];
    },
    count: async (query: unknown) => {
      countCalls.push(query);
      return 1;
    },
  };
  const authorizationRepository = {
    findPermissionsForUser: async () =>
      permissions.map((permission) => Permission.parse(permission)),
  };

  const router = createAuditRouter({
    jwtSecret: "test-secret",
    exportMaxRows: 2,
    repositories: {
      auditEventRepository,
      authorizationRepository,
      userRepository: mockUserRepository,
      deviceRepository: mockDeviceRepository,
    },
  });

  const app = new Hono();
  app.route("/audit", router);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const issueToken = async () =>
    tokenIssuer.issueToken({
      subject: "user-1",
      email: "admin@example.com",
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + 3600,
      issuer: "wildfire",
    });

  return { app, issueToken, listCalls, countCalls };
};

describe("Audit routes", () => {
  test("GET /audit/events returns paginated events when authorized", async () => {
    const { app, issueToken } = await makeApp(["audit:read"]);
    const token = await issueToken();

    const response = await app.request("/audit/events", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      items: Array<{ id: string }>;
      page: number;
      pageSize: number;
      total: number;
    }>(response);
    expect(body.items).toHaveLength(1);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
    expect(body.total).toBe(1);
  });

  test("GET /audit/events forwards normalized filters to use case", async () => {
    const { app, issueToken, listCalls, countCalls } = await makeApp([
      "audit:read",
    ]);
    const token = await issueToken();

    const response = await app.request(
      "/audit/events?page=2&pageSize=30&actorType=user&status=403&action=rbac.user.delete",
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    expect(response.status).toBe(200);
    expect(listCalls).toHaveLength(1);
    expect(countCalls).toHaveLength(1);
    expect(listCalls[0]).toEqual(
      expect.objectContaining({
        offset: 30,
        limit: 30,
        actorType: "user",
        status: 403,
        action: "rbac.user.delete",
      }),
    );
  });

  test("GET /audit/events returns 401 without token", async () => {
    const { app } = await makeApp(["audit:read"]);

    const response = await app.request("/audit/events");
    expect(response.status).toBe(401);
  });

  test("GET /audit/events returns 403 without permission", async () => {
    const { app, issueToken } = await makeApp(["users:read"]);
    const token = await issueToken();

    const response = await app.request("/audit/events", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(403);
  });

  test("GET /audit/events returns 400 for invalid query", async () => {
    const { app, issueToken } = await makeApp(["audit:read"]);
    const token = await issueToken();

    const response = await app.request("/audit/events?status=999", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(400);
  });

  test("GET /audit/events returns 400 when from is after to", async () => {
    const { app, issueToken } = await makeApp(["audit:read"]);
    const token = await issueToken();

    const response = await app.request(
      "/audit/events?from=2026-01-02T00:00:00.000Z&to=2026-01-01T00:00:00.000Z",
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    expect(response.status).toBe(400);
  });

  test("GET /audit/events/export returns CSV when authorized", async () => {
    const { app, issueToken } = await makeApp(["audit:download"]);
    const token = await issueToken();

    const response = await app.request("/audit/events/export", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain(
      "attachment; filename=",
    );
    const body = await response.text();
    expect(body).toContain("occurredAt,requestId,action,route,method,path");
    expect(body).toContain("actorId,actorType,name,");
    expect(body).toContain("rbac.user.update");
    expect(body).toContain('"Admin User"');
  });

  test("GET /audit/events/export resolves unknown actor to fallback name", async () => {
    const auditEventRepository = {
      create: async () => buildAuditEvent("event-created"),
      list: async () => [
        buildAuditEvent("event-1", {
          actorId: "deleted-user",
          actorType: "user",
        }),
      ],
      count: async () => 1,
    };
    const authorizationRepository = {
      findPermissionsForUser: async () => [Permission.parse("audit:download")],
    };
    const router = createAuditRouter({
      jwtSecret: "test-secret",
      exportMaxRows: 2,
      repositories: {
        auditEventRepository,
        authorizationRepository,
        userRepository: mockUserRepository,
        deviceRepository: mockDeviceRepository,
      },
    });
    const app = new Hono();
    app.route("/audit", router);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = await tokenIssuer.issueToken({
      subject: "user-1",
      email: "admin@example.com",
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + 3600,
      issuer: "wildfire",
    });
    const response = await app.request("/audit/events/export", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('"Unknown user"');
  });

  test("GET /audit/events/export returns 401 without token", async () => {
    const { app } = await makeApp(["audit:download"]);
    const response = await app.request("/audit/events/export");
    expect(response.status).toBe(401);
  });

  test("GET /audit/events/export returns 403 without permission", async () => {
    const { app, issueToken } = await makeApp(["audit:read"]);
    const token = await issueToken();
    const response = await app.request("/audit/events/export", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(403);
  });

  test("GET /audit/events/export returns 400 when export exceeds limit", async () => {
    const auditEventRepository = {
      create: async () => buildAuditEvent("event-created"),
      list: async () => [buildAuditEvent("event-1")],
      count: async () => 3,
    };
    const authorizationRepository = {
      findPermissionsForUser: async () => [Permission.parse("audit:download")],
    };
    const router = createAuditRouter({
      jwtSecret: "test-secret",
      exportMaxRows: 2,
      repositories: {
        auditEventRepository,
        authorizationRepository,
        userRepository: mockUserRepository,
        deviceRepository: mockDeviceRepository,
      },
    });

    const app = new Hono();
    app.route("/audit", router);

    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = await tokenIssuer.issueToken({
      subject: "user-1",
      email: "admin@example.com",
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + 3600,
      issuer: "wildfire",
    });

    const overflowResponse = await app.request("/audit/events/export", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    expect(overflowResponse.status).toBe(400);
  });

  test("GET /audit/events/export returns 400 when from is after to", async () => {
    const { app, issueToken } = await makeApp(["audit:download"]);
    const token = await issueToken();
    const response = await app.request(
      "/audit/events/export?from=2026-01-02T00:00:00.000Z&to=2026-01-01T00:00:00.000Z",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    expect(response.status).toBe(400);
  });

  test("GET /audit/events/export neutralizes spreadsheet formulas", async () => {
    const auditEventRepository = {
      create: async () => buildAuditEvent("event-created"),
      list: async () => [buildAuditEvent("event-1", { userAgent: "=2+5" })],
      count: async () => 1,
    };
    const authorizationRepository = {
      findPermissionsForUser: async () => [Permission.parse("audit:download")],
    };
    const router = createAuditRouter({
      jwtSecret: "test-secret",
      exportMaxRows: 2,
      repositories: {
        auditEventRepository,
        authorizationRepository,
        userRepository: mockUserRepository,
        deviceRepository: mockDeviceRepository,
      },
    });

    const app = new Hono();
    app.route("/audit", router);

    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = await tokenIssuer.issueToken({
      subject: "user-1",
      email: "admin@example.com",
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + 3600,
      issuer: "wildfire",
    });

    const response = await app.request("/audit/events/export", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('"\'=2+5"');
  });

  test("GET /audit/events/export returns 500 on unexpected repository failure", async () => {
    const auditEventRepository = {
      create: async () => buildAuditEvent("event-created"),
      list: async () => [buildAuditEvent("event-1")],
      count: async () => {
        throw new Error("db unavailable");
      },
    };
    const authorizationRepository = {
      findPermissionsForUser: async () => [Permission.parse("audit:download")],
    };
    const router = createAuditRouter({
      jwtSecret: "test-secret",
      exportMaxRows: 2,
      repositories: {
        auditEventRepository,
        authorizationRepository,
        userRepository: mockUserRepository,
        deviceRepository: mockDeviceRepository,
      },
    });

    const app = new Hono();
    app.route("/audit", router);

    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = await tokenIssuer.issueToken({
      subject: "user-1",
      email: "admin@example.com",
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + 3600,
      issuer: "wildfire",
    });

    const response = await app.request("/audit/events/export", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(500);
  });
});
