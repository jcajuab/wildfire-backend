import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { CheckPermissionUseCase } from "#/application/use-cases/rbac";
import { Permission } from "#/domain/rbac/permission";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { requestId } from "#/interfaces/http/middleware/observability";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";

describe("permission middleware", () => {
  const tokenIssuer = new JwtTokenIssuer({
    secret: "test-secret",
    issuer: "wildfire",
  });
  const now = Math.floor(Date.now() / 1000);

  const buildMiddleware = (permissions: Permission[]) => {
    const authSessionRepository = {
      create: async () => {},
      extendExpiry: async () => {},
      revokeById: async () => {},
      revokeAllForUser: async () => {},
      isActive: async () => true,
      isOwnedByUser: async () => true,
    };

    const authorizationRepository = {
      findPermissionsForUser: async () => permissions,
      isRootUser: async () => false,
    };

    return createPermissionMiddleware({
      jwtSecret: "test-secret",
      checkPermissionUseCase: new CheckPermissionUseCase({
        authorizationRepository,
      }),
      authSessionRepository,
      authSessionCookieName: "wildfire_session_token",
    });
  };

  const issueToken = async (subject: string) => {
    const token = await tokenIssuer.issueToken({
      subject,
      username: "admin",
      issuedAt: now,
      expiresAt: now + 3600,
      sessionId: "session-1",
      issuer: "wildfire",
    });
    return token;
  };

  test("returns unauthorized for missing token", async () => {
    const { authorize } = buildMiddleware([]);
    const app = new Hono();
    app.use("*", requestId());
    app.get("/displays", ...authorize("displays:read"), (c) =>
      c.json({ ok: true }),
    );

    const response = await app.request("/displays");
    expect(response.status).toBe(401);
  });

  test("returns unauthorized for malformed token", async () => {
    const { authorize } = buildMiddleware([]);
    const app = new Hono();
    app.use("*", requestId());
    app.get("/displays", ...authorize("displays:read"), (c) =>
      c.json({ ok: true }),
    );

    const response = await app.request("/displays", {
      headers: { Authorization: "Bearer not-a-token" },
    });
    expect(response.status).toBe(401);
  });

  test("denies access when user lacks permission", async () => {
    const { authorize } = buildMiddleware([new Permission("users", "read")]);
    const app = new Hono();
    app.use("*", requestId());
    let handlerCalled = false;
    app.get("/displays", ...authorize("displays:read"), (c) => {
      handlerCalled = true;
      return c.json({ ok: true });
    });

    const token = await issueToken("user-1");
    const response = await app.request("/displays", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(403);
    expect(handlerCalled).toBe(false);
  });

  test("allows access when permission matches after normalization", async () => {
    const { authorize } = buildMiddleware([new Permission("displays", "read")]);
    const app = new Hono();
    app.use("*", requestId());
    app.get("/displays", ...authorize("  displays:read "), (c) =>
      c.json({ ok: true }),
    );

    const token = await issueToken("user-1");
    const response = await app.request("/displays", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
