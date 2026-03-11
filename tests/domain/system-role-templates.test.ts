import { describe, expect, test } from "bun:test";
import { ADMIN_PERMISSION } from "#/domain/rbac/canonical-permissions";
import { PREDEFINED_SYSTEM_ROLE_TEMPLATES } from "#/domain/rbac/system-role-templates";

describe("predefined system role templates", () => {
  test("includes the expected locked role set", () => {
    expect(PREDEFINED_SYSTEM_ROLE_TEMPLATES.map((role) => role.name)).toEqual([
      "Editor",
      "Viewer",
    ]);
  });

  test("never includes admin permission in non-admin templates", () => {
    const adminKey = `${ADMIN_PERMISSION.resource}:${ADMIN_PERMISSION.action}`;
    for (const role of PREDEFINED_SYSTEM_ROLE_TEMPLATES) {
      expect(role.permissionKeys.includes(adminKey)).toBe(false);
    }
  });

  test("defines editor permissions as displays:read + content/playlists/schedules CRUD + ai:access", () => {
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
      "ai:access",
    ]);
  });

  test("defines viewer permissions as read-only access", () => {
    const viewer = PREDEFINED_SYSTEM_ROLE_TEMPLATES.find(
      (role) => role.name === "Viewer",
    );
    expect(viewer).toBeDefined();
    expect(viewer?.permissionKeys).toEqual([
      "displays:read",
      "content:read",
      "playlists:read",
      "schedules:read",
    ]);
  });
});
