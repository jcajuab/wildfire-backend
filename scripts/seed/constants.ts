export const DEFAULT_PASSWORD = "password";
export const BCRYPT_SALT_ROUNDS = 10;

export const SUPER_ADMIN_ROLE_NAME = "Super Admin";
export const EDITOR_ROLE_NAME = "Editor";
export const VIEWER_ROLE_NAME = "Viewer";

export const SUPER_ADMIN_PERMISSION = { resource: "*", action: "manage" };

export const STANDARD_RESOURCE_ACTIONS: ReadonlyArray<{
  resource: string;
  action: string;
}> = [
  { resource: "content", action: "read" },
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
  { resource: "devices", action: "read" },
  { resource: "devices", action: "create" },
  { resource: "devices", action: "update" },
  { resource: "devices", action: "delete" },
  { resource: "users", action: "read" },
  { resource: "users", action: "create" },
  { resource: "users", action: "update" },
  { resource: "users", action: "delete" },
  { resource: "roles", action: "read" },
  { resource: "roles", action: "create" },
  { resource: "roles", action: "update" },
  { resource: "roles", action: "delete" },
];

export const DUMMY_USERS: ReadonlyArray<{ email: string; name: string }> = [
  { email: "alice@example.com", name: "Alice Admin" },
  { email: "bob@example.com", name: "Bob Editor" },
  { email: "carol@example.com", name: "Carol Viewer" },
  { email: "dave@example.com", name: "Dave Smith" },
  { email: "eve@example.com", name: "Eve Johnson" },
  { email: "frank@example.com", name: "Frank Williams" },
  { email: "grace@example.com", name: "Grace Brown" },
  { email: "henry@example.com", name: "Henry Davis" },
  { email: "iris@example.com", name: "Iris Miller" },
  { email: "jack@example.com", name: "Jack Wilson" },
  { email: "kate@example.com", name: "Kate Moore" },
  { email: "leo@example.com", name: "Leo Taylor" },
  { email: "mia@example.com", name: "Mia Anderson" },
  { email: "noah@example.com", name: "Noah Thomas" },
  { email: "olivia@example.com", name: "Olivia Jackson" },
];
