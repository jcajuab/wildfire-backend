import {
  CANONICAL_STANDARD_RESOURCE_ACTIONS,
  canonicalPermissionKey,
} from "#/domain/rbac/canonical-permissions";

export interface SystemRoleTemplate {
  readonly name: string;
  readonly description: string;
  readonly permissionKeys: readonly string[];
}

const MODULE_RESOURCES = new Set([
  "displays",
  "content",
  "playlists",
  "schedules",
]);

const nonRootPermissionKeys = CANONICAL_STANDARD_RESOURCE_ACTIONS.map((entry) =>
  canonicalPermissionKey(entry),
);

const readOnlyPermissionKeys = CANONICAL_STANDARD_RESOURCE_ACTIONS.filter(
  (entry) => entry.action === "read",
).map((entry) => canonicalPermissionKey(entry));

const operatorPermissionKeys = CANONICAL_STANDARD_RESOURCE_ACTIONS.filter(
  (entry) => entry.action === "read" && MODULE_RESOURCES.has(entry.resource),
).map((entry) => canonicalPermissionKey(entry));

const editorPermissionKeys = CANONICAL_STANDARD_RESOURCE_ACTIONS.filter(
  (entry) => {
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
  },
).map((entry) => canonicalPermissionKey(entry));

export const PREDEFINED_SYSTEM_ROLE_TEMPLATES: readonly SystemRoleTemplate[] = [
  {
    name: "Admin",
    description: "Full access to all modules except Root-level access",
    permissionKeys: nonRootPermissionKeys,
  },
  {
    name: "Operator",
    description: "Read access for operational modules",
    permissionKeys: operatorPermissionKeys,
  },
  {
    name: "Editor",
    description: "Can manage content, playlists, and schedules",
    permissionKeys: editorPermissionKeys,
  },
  {
    name: "Viewer",
    description: "Read-only access across all modules",
    permissionKeys: readOnlyPermissionKeys,
  },
] as const;
