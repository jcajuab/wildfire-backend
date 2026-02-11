import { writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import {
  SeedStandardPermissionsUseCase,
  SeedSuperAdminRoleUseCase,
  SetUserRolesUseCase,
} from "#/application/use-cases/rbac";
import { env } from "#/env";
import { DeviceDbRepository } from "#/infrastructure/db/repositories/device.repo";
import { PermissionDbRepository } from "#/infrastructure/db/repositories/permission.repo";
import { RoleDbRepository } from "#/infrastructure/db/repositories/role.repo";
import { RolePermissionDbRepository } from "#/infrastructure/db/repositories/role-permission.repo";
import { UserDbRepository } from "#/infrastructure/db/repositories/user.repo";
import { UserRoleDbRepository } from "#/infrastructure/db/repositories/user-role.repo";

const DEFAULT_PASSWORD = "password";
const SALT_ROUNDS = 10;

const DUMMY_USERS: ReadonlyArray<{ email: string; name: string }> = [
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

const SUPER_ADMIN_ROLE_NAME = "Super Admin";
const EDITOR_ROLE_NAME = "Editor";
const VIEWER_ROLE_NAME = "Viewer";

const DUMMY_DEVICES: ReadonlyArray<{
  identifier: string;
  name: string;
  location: string | null;
}> = [
  { identifier: "display-446", name: "446", location: "Building A" },
  {
    identifier: "display-lobby",
    name: "Lobby Display",
    location: "Main Lobby",
  },
  {
    identifier: "display-conference-a",
    name: "Conference Room A",
    location: "Building B",
  },
];

const deviceRepository = new DeviceDbRepository();
const permissionRepository = new PermissionDbRepository();
const roleRepository = new RoleDbRepository();
const rolePermissionRepository = new RolePermissionDbRepository();
const userRepository = new UserDbRepository();
const userRoleRepository = new UserRoleDbRepository();

const seedPermissions = new SeedStandardPermissionsUseCase({
  permissionRepository,
});
const permResult = await seedPermissions.execute();
console.log(`Permissions: ${permResult.created} new permissions created.`);

const seedSuperAdmin = new SeedSuperAdminRoleUseCase({
  roleRepository,
  permissionRepository,
  rolePermissionRepository,
});
await seedSuperAdmin.execute();
console.log("Super Admin role ready.");

const allRoles = await roleRepository.list();
let editorRole = allRoles.find((r) => r.name === EDITOR_ROLE_NAME);
let viewerRole = allRoles.find((r) => r.name === VIEWER_ROLE_NAME);

const allPermissions = await permissionRepository.list();
const readPermissionIds = allPermissions
  .filter((p) => p.action === "read")
  .map((p) => p.id);
const editorPermissionIds = allPermissions
  .filter(
    (p) =>
      p.action === "read" ||
      p.action === "create" ||
      p.action === "update" ||
      (p.resource !== "*" && p.action === "delete"),
  )
  .map((p) => p.id);

if (!editorRole) {
  editorRole = await roleRepository.create({
    name: EDITOR_ROLE_NAME,
    description: "Create and edit content",
    isSystem: false,
  });
  await rolePermissionRepository.setRolePermissions(
    editorRole.id,
    editorPermissionIds,
  );
  console.log(
    `Created role "${EDITOR_ROLE_NAME}" with ${editorPermissionIds.length} permissions.`,
  );
}

if (!viewerRole) {
  viewerRole = await roleRepository.create({
    name: VIEWER_ROLE_NAME,
    description: "Read-only access",
    isSystem: false,
  });
  await rolePermissionRepository.setRolePermissions(
    viewerRole.id,
    readPermissionIds,
  );
  console.log(
    `Created role "${VIEWER_ROLE_NAME}" with ${readPermissionIds.length} permissions.`,
  );
}

const superAdminRole = (await roleRepository.list()).find(
  (r) => r.name === SUPER_ADMIN_ROLE_NAME,
);
if (!superAdminRole) {
  console.error("Super Admin role not found. Run db:seed:super-admin first.");
  process.exit(1);
}

const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, SALT_ROUNDS);
const htshadowLines: string[] = [];
const createdUsers: { id: string; email: string; name: string }[] = [];

for (const { email, name } of DUMMY_USERS) {
  const existing = await userRepository.findByEmail(email);
  if (existing) {
    htshadowLines.push(`${email}:${passwordHash}`);
    continue;
  }
  const user = await userRepository.create({ email, name, isActive: true });
  createdUsers.push({ id: user.id, email: user.email, name: user.name });
  htshadowLines.push(`${user.email}:${passwordHash}`);
}

console.log(
  `Users: ${createdUsers.length} new users created (${DUMMY_USERS.length} total entries for htshadow).`,
);

const htshadowPath = env.HTSHADOW_PATH;
await writeFile(htshadowPath, `${htshadowLines.join("\n")}\n`, "utf-8");
console.log(`Wrote ${htshadowLines.length} entries to ${htshadowPath}.`);

const setUserRoles = new SetUserRolesUseCase({
  userRepository,
  roleRepository,
  userRoleRepository,
});

const allUsers = await userRepository.list();
const orderedUsers = DUMMY_USERS.map((d) =>
  allUsers.find((u) => u.email === d.email),
).filter((u): u is (typeof allUsers)[number] => u != null);

for (let i = 0; i < orderedUsers.length; i += 1) {
  const user = orderedUsers[i];
  if (!user || !superAdminRole) continue;
  if (i === 0) {
    // Assign Super Admin via repository so seed is allowed (use case forbids it for API)
    await userRoleRepository.setUserRoles(user.id, [superAdminRole.id]);
  } else if (i >= 1 && i <= 5 && editorRole) {
    await setUserRoles.execute({ userId: user.id, roleIds: [editorRole.id] });
  } else if (viewerRole) {
    await setUserRoles.execute({ userId: user.id, roleIds: [viewerRole.id] });
  }
}

console.log(
  "Role assignments: 1 Super Admin, 5 Editors, 9 Viewers (for 15 users).",
);

let devicesCreated = 0;
for (const { identifier, name, location } of DUMMY_DEVICES) {
  const existing = await deviceRepository.findByIdentifier(identifier);
  if (existing) continue;
  await deviceRepository.create({ identifier, name, location });
  devicesCreated += 1;
}
console.log(
  devicesCreated > 0
    ? `Devices: ${devicesCreated} dummy device(s) created.`
    : "Devices: 0 new (already present).",
);

console.log(`Done. All seeded users have password: "${DEFAULT_PASSWORD}"`);
console.log(
  "Login with any of the 15 emails and that password to test the app.",
);
