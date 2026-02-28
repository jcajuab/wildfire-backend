export const BCRYPT_SALT_ROUNDS = 10;

export const ROOT_ROLE_NAME = "Root";

export const ROOT_PERMISSION = {
  resource: "root",
  action: "access",
  isRoot: true,
} as const;

export const STANDARD_RESOURCE_ACTIONS: ReadonlyArray<{
  resource: string;
  action: string;
}> = [
  { resource: "content", action: "read" },
  { resource: "content", action: "download" },
  { resource: "content", action: "create" },
  { resource: "content", action: "update" },
  { resource: "content", action: "delete" },
  { resource: "playlists", action: "read" },
  { resource: "playlists", action: "create" },
  { resource: "playlists", action: "update" },
  { resource: "playlists", action: "delete" },
  { resource: "schedules", action: "read" },
  { resource: "schedules", action: "create" },
  { resource: "schedules", action: "update" },
  { resource: "schedules", action: "delete" },
  { resource: "displays", action: "read" },
  { resource: "displays", action: "create" },
  { resource: "displays", action: "update" },
  { resource: "users", action: "read" },
  { resource: "users", action: "create" },
  { resource: "users", action: "update" },
  { resource: "users", action: "delete" },
  { resource: "roles", action: "read" },
  { resource: "roles", action: "create" },
  { resource: "roles", action: "update" },
  { resource: "roles", action: "delete" },
  { resource: "audit", action: "read" },
  { resource: "audit", action: "download" },
  { resource: "settings", action: "read" },
  { resource: "settings", action: "update" },
];
