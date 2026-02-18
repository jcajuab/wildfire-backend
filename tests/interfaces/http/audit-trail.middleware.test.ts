import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { logger } from "#/infrastructure/observability/logger";
import { type AuditEventQueue } from "#/interfaces/http/audit/in-memory-audit-queue";
import { createAuditTrailMiddleware } from "#/interfaces/http/middleware/audit-trail";
import {
  type ObservabilityVariables,
  requestId,
  setAction,
} from "#/interfaces/http/middleware/observability";

const makeQueue = (opts?: { overflow?: boolean }) => {
  const calls: Array<Record<string, unknown>> = [];

  const auditQueue: AuditEventQueue = {
    enqueue: (event) => {
      if (opts?.overflow) {
        return {
          accepted: false,
          reason: "overflow",
        };
      }

      calls.push(event as unknown as Record<string, unknown>);
      return { accepted: true };
    },
    flushNow: async () => {},
    stop: async () => {},
    getStats: () => ({
      queued: calls.length,
      dropped: 0,
      flushed: 0,
      failed: 0,
    }),
  };

  return { calls, auditQueue };
};

describe("audit trail middleware", () => {
  test("records events for mutating actions", async () => {
    const { calls, auditQueue } = makeQueue();
    const app = new Hono<{ Variables: ObservabilityVariables }>();
    app.use("*", requestId());
    app.use("*", createAuditTrailMiddleware({ auditQueue }));

    app.post(
      "/users/:id",
      setAction("rbac.user.update", {
        route: "/users/:id",
        resourceType: "user",
      }),
      (c) => {
        c.set("userId", "user-actor-1");
        c.set("resourceId", "user-target-1");
        return c.json({ ok: true }, 201);
      },
    );

    const response = await app.request("/users/user-target-1", {
      method: "POST",
      headers: {
        "x-forwarded-for": "127.0.0.1, 10.0.0.1",
        "user-agent": "audit-test",
      },
    });

    expect(response.status).toBe(201);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(
      expect.objectContaining({
        action: "rbac.user.update",
        route: "/users/:id",
        method: "POST",
        path: "/users/user-target-1",
        status: 201,
        actorId: "user-actor-1",
        actorType: "user",
        resourceId: "user-target-1",
        resourceType: "user",
        ipAddress: "127.0.0.1",
        userAgent: "audit-test",
      }),
    );
  });

  test("skips non-mutating non-security reads", async () => {
    const { calls, auditQueue } = makeQueue();
    const app = new Hono<{ Variables: ObservabilityVariables }>();
    app.use("*", requestId());
    app.use("*", createAuditTrailMiddleware({ auditQueue }));

    app.get(
      "/content",
      setAction("content.content.list", {
        route: "/content",
        resourceType: "content",
      }),
      (c) => c.json({ items: [] }),
    );

    const response = await app.request("/content");
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(0);
  });

  test("captures failed mutation attempts (401/403)", async () => {
    const { calls, auditQueue } = makeQueue();
    const app = new Hono<{ Variables: ObservabilityVariables }>();
    app.use("*", requestId());
    app.use("*", createAuditTrailMiddleware({ auditQueue }));

    app.post(
      "/protected/no-token",
      setAction("rbac.user.update", {
        route: "/protected/no-token",
        resourceType: "user",
      }),
      (c) => c.json({ error: "Unauthorized" }, 401),
    );

    app.patch(
      "/protected/forbidden",
      setAction("rbac.user.update", {
        route: "/protected/forbidden",
        resourceType: "user",
      }),
      (c) => c.json({ error: "Forbidden" }, 403),
    );

    const unauthorized = await app.request("/protected/no-token", {
      method: "POST",
    });
    const forbidden = await app.request("/protected/forbidden", {
      method: "PATCH",
    });

    expect(unauthorized.status).toBe(401);
    expect(forbidden.status).toBe(403);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(expect.objectContaining({ status: 401 }));
    expect(calls[1]).toEqual(expect.objectContaining({ status: 403 }));
  });

  test("captures permission deny events with safe metadata", async () => {
    const { calls, auditQueue } = makeQueue();
    const app = new Hono<{ Variables: ObservabilityVariables }>();
    app.use("*", requestId());
    app.use("*", createAuditTrailMiddleware({ auditQueue }));

    app.get(
      "/audit-only",
      setAction("authz.permission.deny", {
        route: "/audit-only",
        resourceType: "permission",
      }),
      (c) => {
        c.set("deniedPermission", "audit:read");
        c.set("denyErrorCode", "FORBIDDEN");
        c.set("denyErrorType", "PermissionDenied");
        return c.json({ error: "Forbidden" }, 403);
      },
    );

    const response = await app.request("/audit-only");
    expect(response.status).toBe(403);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(
      expect.objectContaining({
        action: "authz.permission.deny",
        status: 403,
      }),
    );
    const metadataJson = calls[0]?.metadataJson;
    expect(typeof metadataJson).toBe("string");
    expect(String(metadataJson)).toContain("audit:read");
    expect(String(metadataJson)).toContain("FORBIDDEN");
    expect(String(metadataJson)).toContain("PermissionDenied");
  });

  test("logs warning when event is dropped due to queue overflow", async () => {
    const { auditQueue } = makeQueue({ overflow: true });
    const app = new Hono<{ Variables: ObservabilityVariables }>();
    app.use("*", requestId());
    app.use("*", createAuditTrailMiddleware({ auditQueue }));

    app.post(
      "/auth/login",
      setAction("auth.session.login", {
        route: "/auth/login",
        resourceType: "session",
      }),
      (c) => c.json({ ok: true }, 200),
    );

    const warns: Array<Record<string, unknown>> = [];
    const originalWarn = logger.warn;
    logger.warn = ((obj: Record<string, unknown>) => {
      warns.push(obj);
    }) as typeof logger.warn;

    try {
      const response = await app.request("/auth/login", { method: "POST" });
      expect(response.status).toBe(200);
      expect(warns).toHaveLength(1);
      expect(warns[0]).toEqual(
        expect.objectContaining({
          action: "auth.session.login",
          reason: "overflow",
        }),
      );
    } finally {
      logger.warn = originalWarn;
    }
  });
});
