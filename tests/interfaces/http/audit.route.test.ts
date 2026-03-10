import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  type AuditLogRepository,
  type ListAuditLogsQuery,
} from "#/application/ports/audit";
import { createAuditHttpModule } from "#/bootstrap/http/modules";
import { Permission } from "#/domain/rbac/permission";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { createAuditRouter } from "#/interfaces/http/routes/audit.route";

const tokenIssuer = new JwtTokenIssuer({ secret: "test-secret" });
const parseJson = async <T>(response: Response) => (await response.json()) as T;
const authSessionRepository = {
  create: async () => {},
  extendExpiry: async () => {},
  revokeById: async () => {},
  revokeAllForUser: async () => {},
  isActive: async () => true,
  isOwnedByUser: async () => true,
};

const buildAuditLog = (
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
    actorType: "user" | "display" | null;
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
        username: "admin",
        email: "admin@example.com",
        name: "Admin User",
        isActive: true,
      })),
  list: async () => [],
  findById: async () => null,
  findByUsername: async () => null,
  findByEmail: async () => null,
  create: async () => ({
    id: "",
    username: "",
    email: "",
    name: "",
    isActive: true,
  }),
  update: async () => null,
  delete: async () => false,
};

const mockDisplayRepository = {
  findByIds: async (ids: string[]) =>
    ids
      .filter((id) => id === "display-1")
      .map((id) => ({
        id,
        name: "Lobby Display",
        slug: "lobby-display",
        status: "READY" as const,
        location: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      })),
  list: async () => [],
  listPage: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
  findById: async () => null,
  findBySlug: async () => null,
  findByFingerprint: async () => null,
  findByFingerprintAndOutput: async () => null,
  create: async () => ({
    id: "",
    name: "",
    slug: "display-slug",
    status: "READY" as const,
    location: null,
    createdAt: "",
    updatedAt: "",
  }),
  createRegisteredDisplay: async () => {
    throw new Error("not used");
  },
  update: async () => null,
  setStatus: async () => {},
  touchSeen: async () => {},
  bumpRefreshNonce: async () => false,
  delete: async (_id: string) => false,
};

type AuditLogRepositoryStub = Partial<AuditLogRepository>;

const makeApp = async (
  permissions: string[],
  options: {
    auditLogRepository?: AuditLogRepositoryStub;
    exportMaxRows?: number;
  } = {},
) => {
  const listCalls: unknown[] = [];
  const countCalls: unknown[] = [];

  const auditLogRepository: AuditLogRepository = {
    create: async () => buildAuditLog("event-created"),
    list: async (query: ListAuditLogsQuery) => {
      listCalls.push(query);
      return [buildAuditLog("event-1")];
    },
    count: async (query: ListAuditLogsQuery) => {
      countCalls.push(query);
      return 1;
    },
    deleteByRequestIdPrefix: async () => 0,
    ...options.auditLogRepository,
  };
  const authorizationRepository = {
    findPermissionsForUser: async () =>
      permissions.map((permission) => Permission.parse(permission)),
  };

  const router = createAuditRouter(
    createAuditHttpModule({
      jwtSecret: "test-secret",
      authSessionRepository,
      authSessionCookieName: "wildfire_session",
      exportMaxRows: options.exportMaxRows ?? 2,
      repositories: {
        auditLogRepository,
        authorizationRepository,
        userRepository: mockUserRepository,
        displayRepository: mockDisplayRepository,
      },
    }),
  );

  const app = new Hono();
  app.route("/audit", router);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const issueToken = async () =>
    tokenIssuer.issueToken({
      subject: "user-1",
      username: "admin",
      email: "admin@example.com",
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + 3600,
      sessionId: crypto.randomUUID(),
      issuer: "wildfire",
    });

  return { app, issueToken, listCalls, countCalls };
};

describe("Audit routes", () => {
  describe("GET /audit/events", () => {
    test("returns paginated events when authorized", async () => {
      const { app, issueToken } = await makeApp(["audit:read"]);
      const token = await issueToken();

      const response = await app.request("/audit/events", {
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
      expect(body.data).toHaveLength(1);
      expect(body.meta.page).toBe(1);
      expect(body.meta.pageSize).toBe(50);
      expect(body.meta.total).toBe(1);
    });

    test("forwards normalized filters to use case", async () => {
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

    test("returns 401 without token", async () => {
      const { app } = await makeApp(["audit:read"]);

      const response = await app.request("/audit/events");
      expect(response.status).toBe(401);
    });

    test("returns 403 without permission", async () => {
      const { app, issueToken } = await makeApp(["users:read"]);
      const token = await issueToken();

      const response = await app.request("/audit/events", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(403);
    });

    test("returns 422 for invalid query", async () => {
      const { app, issueToken } = await makeApp(["audit:read"]);
      const token = await issueToken();

      const response = await app.request("/audit/events?status=999", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(422);
    });

    test("returns 422 when from is after to", async () => {
      const { app, issueToken } = await makeApp(["audit:read"]);
      const token = await issueToken();

      const response = await app.request(
        "/audit/events?from=2026-01-02T00:00:00.000Z&to=2026-01-01T00:00:00.000Z",
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      expect(response.status).toBe(422);
    });
  });

  describe("GET /audit/events/export", () => {
    test("returns CSV when authorized", async () => {
      const { app, issueToken } = await makeApp(["audit:read"]);
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

    test("resolves unknown actor to fallback name", async () => {
      const { app, issueToken } = await makeApp(["audit:read"], {
        auditLogRepository: {
          create: async () => buildAuditLog("event-created"),
          list: async () => [
            buildAuditLog("event-1", {
              actorId: "deleted-user",
              actorType: "user",
            }),
          ],
          count: async () => 1,
          deleteByRequestIdPrefix: async () => 0,
        },
      });
      const token = await issueToken();

      const response = await app.request("/audit/events/export", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain('"Unknown user"');
    });

    test("returns 401 without token", async () => {
      const { app } = await makeApp(["audit:read"]);
      const response = await app.request("/audit/events/export");
      expect(response.status).toBe(401);
    });

    test("returns 403 without permission", async () => {
      const { app, issueToken } = await makeApp(["users:read"]);
      const token = await issueToken();
      const response = await app.request("/audit/events/export", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(403);
    });

    test("returns 400 when export exceeds limit", async () => {
      const { app, issueToken } = await makeApp(["audit:read"], {
        auditLogRepository: {
          create: async () => buildAuditLog("event-created"),
          list: async () => [buildAuditLog("event-1")],
          count: async () => 3,
          deleteByRequestIdPrefix: async () => 0,
        },
      });
      const token = await issueToken();

      const overflowResponse = await app.request("/audit/events/export", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(overflowResponse.status).toBe(400);
    });

    test("returns 422 when from is after to", async () => {
      const { app, issueToken } = await makeApp(["audit:read"]);
      const token = await issueToken();
      const response = await app.request(
        "/audit/events/export?from=2026-01-02T00:00:00.000Z&to=2026-01-01T00:00:00.000Z",
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      expect(response.status).toBe(422);
    });

    test("neutralizes spreadsheet formulas", async () => {
      const { app, issueToken } = await makeApp(["audit:read"], {
        auditLogRepository: {
          create: async () => buildAuditLog("event-created"),
          list: async () => [buildAuditLog("event-1", { userAgent: "=2+5" })],
          count: async () => 1,
          deleteByRequestIdPrefix: async () => 0,
        },
      });
      const token = await issueToken();

      const response = await app.request("/audit/events/export", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain('"\'=2+5"');
    });

    test("returns 500 on unexpected repository failure", async () => {
      const { app, issueToken } = await makeApp(["audit:read"], {
        auditLogRepository: {
          create: async () => buildAuditLog("event-created"),
          list: async () => [buildAuditLog("event-1")],
          count: async () => {
            throw new Error("db unavailable");
          },
          deleteByRequestIdPrefix: async () => 0,
        },
      });
      const token = await issueToken();

      const response = await app.request("/audit/events/export", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      expect(response.status).toBe(500);
    });
  });
});
