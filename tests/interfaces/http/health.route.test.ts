import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createHealthRouter } from "#/interfaces/http/routes/health.route";

const parseJson = async <T>(response: Response): Promise<T> =>
  (await response.json()) as T;

describe("Health routes", () => {
  test("GET / returns 200 with ok status", async () => {
    const app = new Hono();
    app.route("/v1/health", createHealthRouter());

    const response = await app.request("/v1/health");
    const payload = await parseJson<{ data: { status: "ok" } }>(response);

    expect(response.status).toBe(200);
    expect(payload).toEqual({ data: { status: "ok" } });
  });

  test("GET /ready returns 200 when all dependencies pass", async () => {
    const app = new Hono();
    app.route(
      "/v1/health",
      createHealthRouter({
        checkMySql: async () => ({ ok: true }),
        checkRedis: async () => ({ ok: true }),
        checkAuditStream: async () => ({ ok: true }),
        checkStorage: async () => ({ ok: true }),
      }),
    );

    const response = await app.request("/v1/health/ready");
    const payload = await parseJson<{
      data: {
        status: "ok";
        dependencies: {
          mysql: { ok: boolean; error?: string };
          redis: { ok: boolean; error?: string };
          auditStream: { ok: boolean; error?: string };
          storage: { ok: boolean; error?: string };
        };
      };
    }>(response);

    expect(response.status).toBe(200);
    expect(payload.data.status).toBe("ok");
    expect(payload.data.dependencies).toEqual({
      mysql: { ok: true },
      redis: { ok: true },
      auditStream: { ok: true },
      storage: { ok: true },
    });
  });

  test("GET /ready returns 503 when any dependency fails", async () => {
    const app = new Hono();
    app.route(
      "/v1/health",
      createHealthRouter({
        checkMySql: async () => ({ ok: true }),
        checkRedis: async () => ({ ok: false, error: "redis unavailable" }),
        checkAuditStream: async () => ({ ok: true }),
        checkStorage: async () => ({ ok: true }),
      }),
    );

    const response = await app.request("/v1/health/ready");
    const payload = await parseJson<{
      data: {
        status: "degraded";
        dependencies: {
          mysql: { ok: boolean; error?: string };
          redis: { ok: boolean; error?: string };
          auditStream: { ok: boolean; error?: string };
          storage: { ok: boolean; error?: string };
        };
      };
    }>(response);

    expect(response.status).toBe(503);
    expect(payload.data.status).toBe("degraded");
    expect(payload.data.dependencies.redis).toEqual({
      ok: false,
      error: "redis unavailable",
    });
  });

  test("GET /ready wraps thrown dependency errors as failed checks", async () => {
    const app = new Hono();
    app.route(
      "/v1/health",
      createHealthRouter({
        checkMySql: async () => ({ ok: true }),
        checkRedis: async () => {
          throw new Error("connection timeout");
        },
        checkAuditStream: async () => ({ ok: true }),
        checkStorage: async () => ({ ok: true }),
      }),
    );

    const response = await app.request("/v1/health/ready");
    const payload = await parseJson<{
      data: {
        status: "degraded";
        dependencies: {
          mysql: { ok: boolean; error?: string };
          redis: { ok: boolean; error?: string };
          auditStream: { ok: boolean; error?: string };
          storage: { ok: boolean; error?: string };
        };
      };
    }>(response);

    expect(response.status).toBe(503);
    expect(payload.data.dependencies.redis.ok).toBe(false);
    expect(payload.data.dependencies.redis.error).toBe(
      "redis readiness check: connection timeout",
    );
  });
});
