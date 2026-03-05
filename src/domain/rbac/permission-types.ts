export type PermissionResource =
  | "root"
  | "displays"
  | "content"
  | "playlists"
  | "schedules"
  | "users"
  | "roles"
  | "audit";

export type PermissionAction =
  | "access"
  | "read"
  | "create"
  | "update"
  | "delete";

export type PermissionType = `${PermissionResource}:${PermissionAction}`;
