import {
  CANONICAL_STANDARD_RESOURCE_ACTIONS,
  canonicalPermissionKey,
} from "#/domain/rbac/canonical-permissions";

export interface SystemRoleTemplate {
  readonly name: string;
  readonly description: string;
  readonly permissionKeys: readonly string[];
}

const editorPermissionKeys = [
  ...CANONICAL_STANDARD_RESOURCE_ACTIONS.filter((entry) => {
    if (entry.resource === "displays" && entry.action === "read") {
      return true;
    }

    if (
      entry.resource === "content" ||
      entry.resource === "playlists" ||
      entry.resource === "schedules"
    ) {
      return (
        entry.action === "create" ||
        entry.action === "read" ||
        entry.action === "update" ||
        entry.action === "delete"
      );
    }

    return false;
  }).map((entry) => canonicalPermissionKey(entry)),
  "ai:access",
] as const;

export const PREDEFINED_SYSTEM_ROLE_TEMPLATES: readonly SystemRoleTemplate[] = [
  {
    name: "Editor",
    description: "Can manage content, playlists, and schedules",
    permissionKeys: editorPermissionKeys,
  },
  {
    name: "Viewer",
    description:
      "Read-only access to displays, content, playlists, and schedules",
    permissionKeys: [
      "displays:read",
      "content:read",
      "playlists:read",
      "schedules:read",
    ],
  },
] as const;
