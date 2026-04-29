import { describe, expect, test } from "bun:test";
import {
  buildServerCacheKey,
  getOrSetJson,
  getServerCacheVersions,
  type ServerCacheStore,
  serverCacheTtlSeconds,
} from "#/infrastructure/redis/server-cache";

const createStore = (
  initial?: Record<string, string>,
): ServerCacheStore & {
  values: Map<string, string>;
  setCalls: number;
} => {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    values,
    setCalls: 0,
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value) {
      this.setCalls += 1;
      values.set(key, value);
    },
    async getMany(keys) {
      return keys.map((key) => values.get(key) ?? null);
    },
    async increment(key) {
      values.set(key, String(Number(values.get(key) ?? "0") + 1));
    },
  };
};

describe("server cache", () => {
  test("normalizes query parameter order in cache keys", () => {
    const left = buildServerCacheKey({
      method: "get",
      url: "https://api.example.com/v1/content?b=2&a=1&a=0",
      domains: ["content"],
      versions: ["7"],
    });
    const right = buildServerCacheKey({
      method: "GET",
      url: "https://api.example.com/v1/content?a=0&a=1&b=2",
      domains: ["content"],
      versions: ["7"],
    });

    expect(left).toBe(right);
  });

  test("domain version changes produce different cache keys", () => {
    const before = buildServerCacheKey({
      method: "GET",
      url: "https://api.example.com/v1/playlists",
      domains: ["playlists"],
      versions: ["1"],
    });
    const after = buildServerCacheKey({
      method: "GET",
      url: "https://api.example.com/v1/playlists",
      domains: ["playlists"],
      versions: ["2"],
    });

    expect(before).not.toBe(after);
  });

  test("loads missing domain versions as zero", async () => {
    const store = createStore({ "wf:cache:version:content": "3" });
    await expect(
      getServerCacheVersions(store, ["content", "playlists"]),
    ).resolves.toEqual(["3", "0"]);
  });

  test("returns cached JSON on hit", async () => {
    const store = createStore({ key: JSON.stringify({ ok: true }) });
    const result = await getOrSetJson({
      store,
      key: "key",
      ttlSeconds: 60,
      compute: async () => ({ ok: false }),
    });

    expect(result).toEqual({ status: "HIT", value: { ok: true } });
    expect(store.setCalls).toBe(0);
  });

  test("stores computed JSON on miss", async () => {
    const store = createStore();
    const result = await getOrSetJson({
      store,
      key: "key",
      ttlSeconds: 60,
      compute: async () => ({ ok: true }),
    });

    expect(result).toEqual({ status: "MISS", value: { ok: true } });
    expect(store.values.get("key")).toBe(JSON.stringify({ ok: true }));
  });

  test("does not cache thrown computations", async () => {
    const store = createStore();
    await expect(
      getOrSetJson({
        store,
        key: "key",
        ttlSeconds: 60,
        compute: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");

    expect(store.values.has("key")).toBe(false);
  });

  test("reads configured TTL buckets", () => {
    expect(serverCacheTtlSeconds("default")).toBe(120);
    expect(serverCacheTtlSeconds("dynamic")).toBe(30);
    expect(serverCacheTtlSeconds("reference")).toBe(300);
  });
});
