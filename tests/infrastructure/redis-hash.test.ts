import { describe, expect, test } from "bun:test";
import { normalizeRedisHash } from "#/infrastructure/redis/hashes";

describe("normalizeRedisHash", () => {
  test("normalizes Redis HGETALL array replies", () => {
    const normalized = normalizeRedisHash([
      "id",
      "attempt-1",
      "createdById",
      "user-1",
      "createdAtMs",
      "123",
    ]);

    expect(normalized).toEqual({
      id: "attempt-1",
      createdById: "user-1",
      createdAtMs: "123",
    });
  });

  test("normalizes Redis HGETALL object replies", () => {
    const normalized = normalizeRedisHash({
      id: "attempt-2",
      createdAtMs: 987,
      activeCodeExpiresAtMs: null,
    });

    expect(normalized).toEqual({
      id: "attempt-2",
      createdAtMs: "987",
      activeCodeExpiresAtMs: "",
    });
  });

  test("normalizes Redis HGETALL map replies", () => {
    const map = new Map<string, number>([
      ["id", 1],
      ["value", 2],
    ]);

    const normalized = normalizeRedisHash(map);

    expect(normalized).toEqual({
      id: "1",
      value: "2",
    });
  });

  test("handles null/undefined as empty hash", () => {
    expect(normalizeRedisHash(null)).toEqual({});
    expect(normalizeRedisHash(undefined)).toEqual({});
  });

  test("ignores trailing odd-length Redis array entries", () => {
    const normalized = normalizeRedisHash(["id", "attempt-3", "dangling"]);

    expect(normalized).toEqual({ id: "attempt-3" });
  });
});
