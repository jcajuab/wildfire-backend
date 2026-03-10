export const ADMIN_PERMISSION = {
  resource: "admin",
  action: "access",
  isAdmin: true,
} as const;

export const CANONICAL_STANDARD_RESOURCE_ACTIONS = [
  { resource: "displays", action: "create" },
  { resource: "displays", action: "read" },
  { resource: "displays", action: "update" },
  { resource: "displays", action: "delete" },
  { resource: "content", action: "create" },
  { resource: "content", action: "read" },
  { resource: "content", action: "update" },
  { resource: "content", action: "delete" },
  { resource: "playlists", action: "create" },
  { resource: "playlists", action: "read" },
  { resource: "playlists", action: "update" },
  { resource: "playlists", action: "delete" },
  { resource: "schedules", action: "create" },
  { resource: "schedules", action: "read" },
  { resource: "schedules", action: "update" },
  { resource: "schedules", action: "delete" },
  { resource: "users", action: "create" },
  { resource: "users", action: "read" },
  { resource: "users", action: "update" },
  { resource: "users", action: "delete" },
  { resource: "roles", action: "create" },
  { resource: "roles", action: "read" },
  { resource: "roles", action: "update" },
  { resource: "roles", action: "delete" },
  { resource: "audit", action: "read" },
] as const satisfies ReadonlyArray<{
  readonly resource: string;
  readonly action: string;
}>;

export const canonicalPermissionKey = (input: {
  resource: string;
  action: string;
}): string => `${input.resource}:${input.action}`;
