import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

process.env.SERVER_CACHE_ENABLED = "true";
process.env.REDIS_KEY_PREFIX = "wf-test-cache";

const redisValues = new Map<string, string>();
const cacheWrites: Array<{ key: string; ttlSeconds: number; value: string }> =
  [];

const redisCommands = {
  get: async (key: string) => redisValues.get(key) ?? null,
  set: async (
    key: string,
    value: string,
    options?: { EX?: number },
  ): Promise<string> => {
    redisValues.set(key, value);
    cacheWrites.push({ key, value, ttlSeconds: options?.EX ?? 0 });
    return "OK";
  },
  mGet: async (keys: string[]) =>
    keys.map((key) => redisValues.get(key) ?? null),
  incr: async (key: string): Promise<number> => {
    const next = Number(redisValues.get(key) ?? "0") + 1;
    redisValues.set(key, String(next));
    return next;
  },
};

mock.module("#/infrastructure/redis/client", () => ({
  getRedisCommandClient: async () => ({
    withAbortSignal: () => redisCommands,
  }),
  executeRedisCommand: async <T>(
    command: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> => command(new AbortController().signal),
}));

const { Hono } = await import("hono");
const { jsonWithServerCache, invalidateServerCache } = await import(
  "#/interfaces/http/cache/server-cache"
);
const { setServerCacheEnabledForTesting } = await import(
  "#/infrastructure/redis/server-cache"
);

const createCacheApp = () => {
  const app = new Hono();
  app.onError((error, c) =>
    c.json({ error: error instanceof Error ? error.message : "error" }, 500),
  );
  return app;
};

beforeEach(() => {
  setServerCacheEnabledForTesting(true);
  redisValues.clear();
  cacheWrites.length = 0;
});

afterEach(() => {
  setServerCacheEnabledForTesting(undefined);
});

describe("HTTP server cache", () => {
  test("returns MISS then HIT for the same normalized query", async () => {
    const app = createCacheApp();
    let computeCount = 0;

    app.get("/cached", async (c) =>
      jsonWithServerCache(c, { domains: ["content"] }, async () => {
        computeCount += 1;
        return { data: { computeCount } };
      }),
    );

    const first = await app.request("/cached?b=2&a=1");
    const second = await app.request("/cached?a=1&b=2");

    expect(first.headers.get("X-Server-Cache")).toBe("MISS");
    expect(second.headers.get("X-Server-Cache")).toBe("HIT");
    expect(second.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await second.json()).toEqual({ data: { computeCount: 1 } });
    expect(computeCount).toBe(1);
    expect(cacheWrites).toHaveLength(1);
  });

  test("version invalidation forces a cached route to recompute", async () => {
    const app = createCacheApp();
    let computeCount = 0;

    app.get("/content", async (c) =>
      jsonWithServerCache(c, { domains: ["content"] }, async () => {
        computeCount += 1;
        return { data: { computeCount } };
      }),
    );

    expect((await app.request("/content")).headers.get("X-Server-Cache")).toBe(
      "MISS",
    );
    expect((await app.request("/content")).headers.get("X-Server-Cache")).toBe(
      "HIT",
    );

    await invalidateServerCache(["content"]);

    const afterInvalidation = await app.request("/content");
    expect(afterInvalidation.headers.get("X-Server-Cache")).toBe("MISS");
    expect(await afterInvalidation.json()).toEqual({
      data: { computeCount: 2 },
    });
  });

  test("unauthorized requests do not populate cache entries", async () => {
    const app = createCacheApp();
    let computeCount = 0;

    app.get("/authorized", async (c) => {
      if (c.req.header("Authorization") !== "Bearer ok") {
        return c.json({ error: "unauthorized" }, 401);
      }
      return jsonWithServerCache(c, { domains: ["content"] }, async () => {
        computeCount += 1;
        return { data: { computeCount } };
      });
    });

    const unauthorized = await app.request("/authorized");
    const authorized = await app.request("/authorized", {
      headers: { Authorization: "Bearer ok" },
    });

    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("X-Server-Cache")).toBeNull();
    expect(authorized.headers.get("X-Server-Cache")).toBe("MISS");
    expect(computeCount).toBe(1);
  });

  test("permission-shaped responses do not share cache entries", async () => {
    const app = createCacheApp();
    let computeCount = 0;

    app.get("/bootstrap", async (c) => {
      const permission = c.req.header("X-Permission") ?? "content:read";
      c.set("jwtPayload", { isAdmin: false, permissions: [permission] });
      return jsonWithServerCache(
        c,
        { domains: ["content"], varyByPermissions: true },
        async () => {
          computeCount += 1;
          return { data: { permission, computeCount } };
        },
      );
    });

    const content = await app.request("/bootstrap", {
      headers: { "X-Permission": "content:read" },
    });
    const displays = await app.request("/bootstrap", {
      headers: { "X-Permission": "displays:read" },
    });
    const contentAgain = await app.request("/bootstrap", {
      headers: { "X-Permission": "content:read" },
    });

    expect(content.headers.get("X-Server-Cache")).toBe("MISS");
    expect(displays.headers.get("X-Server-Cache")).toBe("MISS");
    expect(contentAgain.headers.get("X-Server-Cache")).toBe("HIT");
    expect(await contentAgain.json()).toEqual({
      data: { permission: "content:read", computeCount: 1 },
    });
    expect(computeCount).toBe(2);
  });

  test("thrown route computations are not cached", async () => {
    const app = createCacheApp();
    let computeCount = 0;

    app.get("/boom", async (c) =>
      jsonWithServerCache(c, { domains: ["content"] }, async () => {
        computeCount += 1;
        throw new Error("boom");
      }),
    );

    const first = await app.request("/boom");
    const second = await app.request("/boom");

    expect(first.status).toBe(500);
    expect(second.status).toBe(500);
    expect(computeCount).toBe(2);
    expect(cacheWrites).toHaveLength(0);
  });
});
