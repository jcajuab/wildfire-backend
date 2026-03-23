import {
  type PermissionAction,
  type PermissionResource,
} from "./permission-types";

const VALID_RESOURCES: ReadonlySet<string> = new Set<PermissionResource>([
  "admin",
  "displays",
  "content",
  "playlists",
  "schedules",
  "users",
  "roles",
  "audit",
  "ai",
]);

const VALID_ACTIONS: ReadonlySet<string> = new Set<PermissionAction>([
  "access",
  "read",
  "create",
  "update",
  "delete",
]);

export class Permission {
  constructor(
    public readonly resource: PermissionResource,
    public readonly action: PermissionAction,
  ) {}

  static parse(value: string): Permission {
    const [resource, action] = value.split(":");
    if (!resource || !action) {
      throw new Error("Permission must be in resource:action format");
    }
    if (!VALID_RESOURCES.has(resource)) {
      throw new Error(
        `Invalid permission resource "${resource}". Valid resources: ${[...VALID_RESOURCES].join(", ")}`,
      );
    }
    if (!VALID_ACTIONS.has(action)) {
      throw new Error(
        `Invalid permission action "${action}". Valid actions: ${[...VALID_ACTIONS].join(", ")}`,
      );
    }
    return new Permission(
      resource as PermissionResource,
      action as PermissionAction,
    );
  }

  matches(required: Permission): boolean {
    return (
      this.resource === required.resource && this.action === required.action
    );
  }
}
