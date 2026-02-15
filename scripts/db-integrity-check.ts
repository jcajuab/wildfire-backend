import { eq, isNull, sql } from "drizzle-orm";
import "#/env";
import { db } from "#/infrastructure/db/client";
import { content } from "#/infrastructure/db/schema/content.sql";
import { devices } from "#/infrastructure/db/schema/device.sql";
import { playlists } from "#/infrastructure/db/schema/playlist.sql";
import {
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from "#/infrastructure/db/schema/rbac.sql";

type IntegrityCheck = {
  name: string;
  count: number;
};

const countRows = async <T>(promise: Promise<T[]>): Promise<number> =>
  (await promise).length;

const runChecks = async (): Promise<IntegrityCheck[]> => {
  const duplicateEmails = await countRows(
    db
      .select({ email: users.email })
      .from(users)
      .groupBy(users.email)
      .having(sql`count(*) > 1`),
  );

  const duplicateRoleNames = await countRows(
    db
      .select({ name: roles.name })
      .from(roles)
      .groupBy(roles.name)
      .having(sql`count(*) > 1`),
  );

  const duplicatePermissionPairs = await countRows(
    db
      .select({
        resource: permissions.resource,
        action: permissions.action,
      })
      .from(permissions)
      .groupBy(permissions.resource, permissions.action)
      .having(sql`count(*) > 1`),
  );

  const duplicateDeviceIdentifiers = await countRows(
    db
      .select({ identifier: devices.identifier })
      .from(devices)
      .groupBy(devices.identifier)
      .having(sql`count(*) > 1`),
  );

  const orphanContentCreators = await countRows(
    db
      .select({ id: content.id })
      .from(content)
      .leftJoin(users, eq(content.createdById, users.id))
      .where(isNull(users.id)),
  );

  const orphanPlaylistCreators = await countRows(
    db
      .select({ id: playlists.id })
      .from(playlists)
      .leftJoin(users, eq(playlists.createdById, users.id))
      .where(isNull(users.id)),
  );

  const orphanUserRolesUsers = await countRows(
    db
      .select({
        userId: userRoles.userId,
        roleId: userRoles.roleId,
      })
      .from(userRoles)
      .leftJoin(users, eq(userRoles.userId, users.id))
      .where(isNull(users.id)),
  );

  const orphanUserRolesRoles = await countRows(
    db
      .select({
        userId: userRoles.userId,
        roleId: userRoles.roleId,
      })
      .from(userRoles)
      .leftJoin(roles, eq(userRoles.roleId, roles.id))
      .where(isNull(roles.id)),
  );

  const orphanRolePermissionsRoles = await countRows(
    db
      .select({
        roleId: rolePermissions.roleId,
        permissionId: rolePermissions.permissionId,
      })
      .from(rolePermissions)
      .leftJoin(roles, eq(rolePermissions.roleId, roles.id))
      .where(isNull(roles.id)),
  );

  const orphanRolePermissionsPermissions = await countRows(
    db
      .select({
        roleId: rolePermissions.roleId,
        permissionId: rolePermissions.permissionId,
      })
      .from(rolePermissions)
      .leftJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(isNull(permissions.id)),
  );

  return [
    { name: "duplicate users.email", count: duplicateEmails },
    { name: "duplicate roles.name", count: duplicateRoleNames },
    {
      name: "duplicate permissions(resource,action)",
      count: duplicatePermissionPairs,
    },
    {
      name: "duplicate devices.identifier",
      count: duplicateDeviceIdentifiers,
    },
    { name: "orphan content.created_by_id", count: orphanContentCreators },
    { name: "orphan playlists.created_by_id", count: orphanPlaylistCreators },
    { name: "orphan user_roles.user_id", count: orphanUserRolesUsers },
    { name: "orphan user_roles.role_id", count: orphanUserRolesRoles },
    {
      name: "orphan role_permissions.role_id",
      count: orphanRolePermissionsRoles,
    },
    {
      name: "orphan role_permissions.permission_id",
      count: orphanRolePermissionsPermissions,
    },
  ];
};

const checks = await runChecks();
const failed = checks.filter((check) => check.count > 0);

if (failed.length > 0) {
  console.error("Database integrity check failed:");
  for (const check of failed) {
    console.error(`- ${check.name}: ${check.count}`);
  }
  process.exit(1);
}

console.log("Database integrity check passed: no integrity violations found.");
