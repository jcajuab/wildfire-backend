import { describe, expect, test } from "bun:test";
import { Permission } from "#/domain/rbac/permission";

describe("Permission", () => {
  test("parses resource:action", () => {
    const permission = Permission.parse("content:read");

    expect(permission.resource).toBe("content");
    expect(permission.action).toBe("read");
  });

  test("throws on invalid format", () => {
    expect(() => Permission.parse("invalid")).toThrow(
      "Permission must be in resource:action format",
    );
  });

  test("matches exact permission", () => {
    const owned = Permission.parse("content:read");
    const required = Permission.parse("content:read");

    expect(owned.matches(required)).toBe(true);
  });

  test("does not match when action differs", () => {
    const owned = Permission.parse("content:read");
    const required = Permission.parse("content:delete");

    expect(owned.matches(required)).toBe(false);
  });

  test("does not match when resource differs", () => {
    const owned = Permission.parse("content:update");
    const required = Permission.parse("users:update");

    expect(owned.matches(required)).toBe(false);
  });
});
