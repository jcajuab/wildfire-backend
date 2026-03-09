import { describe, expect, test } from "bun:test";
import { ROOT_PERMISSION } from "#/domain/rbac/canonical-permissions";
import { PREDEFINED_SYSTEM_ROLE_TEMPLATES } from "#/domain/rbac/system-role-templates";

describe("predefined system role templates", () => {
  test("includes the expected locked role set", () => {
    expect(PREDEFINED_SYSTEM_ROLE_TEMPLATES.map((role) => role.name)).toEqual([
      "Admin",
      "Operator",
      "Editor",
      "Viewer",
    ]);
  });

  test("never includes root permission in non-root templates", () => {
    const rootKey = `${ROOT_PERMISSION.resource}:${ROOT_PERMISSION.action}`;
    for (const role of PREDEFINED_SYSTEM_ROLE_TEMPLATES) {
      expect(role.permissionKeys.includes(rootKey)).toBe(false);
    }
  });

  test("defines editor permissions as displays:read + content/playlists/schedules CRUD", () => {
    const editor = PREDEFINED_SYSTEM_ROLE_TEMPLATES.find(
      (role) => role.name === "Editor",
    );
    expect(editor).toBeDefined();
    expect(editor?.permissionKeys).toEqual([
      "displays:read",
      "content:create",
      "content:read",
      "content:update",
      "content:delete",
      "playlists:create",
      "playlists:read",
      "playlists:update",
      "playlists:delete",
      "schedules:create",
      "schedules:read",
      "schedules:update",
      "schedules:delete",
    ]);
  });
});
