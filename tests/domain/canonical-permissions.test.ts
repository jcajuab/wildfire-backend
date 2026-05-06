import { describe, expect, test } from "bun:test";
import {
  ADMIN_PERMISSION,
  CANONICAL_STANDARD_RESOURCE_ACTIONS,
  canonicalPermissionKey,
} from "#/domain/rbac/canonical-permissions";

describe("canonical permissions", () => {
  test("includes audit deletion as an assignable standard permission", () => {
    const permissionKeys = CANONICAL_STANDARD_RESOURCE_ACTIONS.map(
      canonicalPermissionKey,
    );

    expect(permissionKeys).toContain("audit:read");
    expect(permissionKeys).toContain("audit:delete");
  });

  test("keeps admin access separate from assignable standard permissions", () => {
    const permissionKeys = CANONICAL_STANDARD_RESOURCE_ACTIONS.map(
      canonicalPermissionKey,
    );

    expect(canonicalPermissionKey(ADMIN_PERMISSION)).toBe("admin:access");
    expect(permissionKeys).not.toContain("admin:access");
  });
});
