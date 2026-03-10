import bcrypt from "bcryptjs";
import {
  type PermissionRepository,
  type RolePermissionRepository,
  type RoleRepository,
  type UserRepository,
  type UserRoleRepository,
} from "#/application/ports/rbac";
import { ADMIN_PERMISSION } from "#/domain/rbac/canonical-permissions";
import { db } from "#/infrastructure/db/client";
import { writeHtshadowMap } from "./htshadow-file.adapter";

const ADMIN_ROLE_NAME = "Admin";
const BCRYPT_SALT_ROUNDS = 10;

const uniqueIds = (values: readonly string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
};

const deriveUserName = (username: string): string => {
  const trimmed = username.trim();
  if (!trimmed) {
    return "User";
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
};

export interface AdminRolePermissionSyncMetrics {
  createdAdminRole: boolean;
  createdAdminPermission: boolean;
  assignedAdminPermissionToAdminRole: boolean;
  adminPermissionPurgedFromOtherRoles: number;
}

export interface AdminUserSyncMetrics {
  adminUserCreated: boolean;
  adminUserUpdated: boolean;
  adminRoleAssignedToAdminUser: boolean;
}

/**
 * Ensures Admin role exists, Admin permission exists, and they are properly associated.
 * Also purges admin permission from all other roles for security.
 */
export const ensureAdminRoleAndPermission = async (deps: {
  roleRepository: RoleRepository;
  permissionRepository: PermissionRepository;
  rolePermissionRepository: RolePermissionRepository;
}): Promise<
  AdminRolePermissionSyncMetrics & {
    adminRoleId: string;
    adminPermissionId: string;
  }
> => {
  return db.transaction(async () => {
    const result: AdminRolePermissionSyncMetrics = {
      createdAdminRole: false,
      createdAdminPermission: false,
      assignedAdminPermissionToAdminRole: false,
      adminPermissionPurgedFromOtherRoles: 0,
    };

    const roles = await deps.roleRepository.list();
    let adminRole = roles.find((role) => role.name === ADMIN_ROLE_NAME) ?? null;
    if (!adminRole) {
      result.createdAdminRole = true;
      adminRole = await deps.roleRepository.create({
        name: ADMIN_ROLE_NAME,
        description: "Global admin access",
      });
    }

    const permissions = await deps.permissionRepository.list();
    let adminPermission =
      permissions.find(
        (permission) =>
          permission.resource === ADMIN_PERMISSION.resource &&
          permission.action === ADMIN_PERMISSION.action,
      ) ?? null;

    if (!adminPermission) {
      result.createdAdminPermission = true;
      adminPermission =
        await deps.permissionRepository.create(ADMIN_PERMISSION);
    } else if (adminPermission.isAdmin !== true) {
      if (!deps.permissionRepository.updateIsAdmin) {
        throw new Error(
          "permissionRepository.updateIsAdmin is required for admin permission enforcement",
        );
      }
      await deps.permissionRepository.updateIsAdmin(adminPermission.id, true);
      adminPermission = { ...adminPermission, isAdmin: true };
    }

    const adminRoleAssignments =
      await deps.rolePermissionRepository.listPermissionsByRoleId(adminRole.id);
    const adminPermissionIds = adminRoleAssignments.map(
      (assignment) => assignment.permissionId,
    );
    const hasExactAdminPermissionOnly =
      adminPermissionIds.length === 1 &&
      adminPermissionIds[0] === adminPermission.id;
    if (!hasExactAdminPermissionOnly) {
      result.assignedAdminPermissionToAdminRole = true;
      await deps.rolePermissionRepository.setRolePermissions(adminRole.id, [
        adminPermission.id,
      ]);
    }

    for (const role of roles) {
      if (role.id === adminRole.id) {
        continue;
      }
      const assignments =
        await deps.rolePermissionRepository.listPermissionsByRoleId(role.id);
      const permissionIds = assignments.map(
        (assignment) => assignment.permissionId,
      );
      if (!permissionIds.includes(adminPermission.id)) {
        continue;
      }
      result.adminPermissionPurgedFromOtherRoles += 1;
      const nextPermissionIds = uniqueIds(
        permissionIds.filter(
          (permissionId) => permissionId !== adminPermission.id,
        ),
      );
      await deps.rolePermissionRepository.setRolePermissions(
        role.id,
        nextPermissionIds,
      );
    }

    return {
      ...result,
      adminRoleId: adminRole.id,
      adminPermissionId: adminPermission.id,
    };
  });
};

/**
 * Ensures admin user exists in the directory with correct email/name.
 * Assigns Admin role exclusively to admin user and purges it from all other users.
 */
export const ensureAdminUser = async (deps: {
  userRepository: UserRepository;
  userRoleRepository: UserRoleRepository;
  adminRoleId: string;
  adminUsername: string;
  adminEmail: string | null;
}): Promise<AdminUserSyncMetrics> => {
  return db.transaction(async () => {
    const result: AdminUserSyncMetrics = {
      adminUserCreated: false,
      adminUserUpdated: false,
      adminRoleAssignedToAdminUser: false,
    };

    const expectedName = deriveUserName(deps.adminUsername);
    let adminUser = await deps.userRepository.findByUsername(
      deps.adminUsername,
    );

    if (!adminUser) {
      adminUser = await deps.userRepository.create({
        username: deps.adminUsername,
        email: deps.adminEmail,
        name: expectedName,
        isActive: true,
      });
      result.adminUserCreated = true;
    } else {
      const shouldUpdate =
        adminUser.email !== deps.adminEmail ||
        adminUser.name !== expectedName ||
        adminUser.isActive !== true;
      if (shouldUpdate) {
        adminUser =
          (await deps.userRepository.update(adminUser.id, {
            email: deps.adminEmail,
            name: expectedName,
            isActive: true,
          })) ?? adminUser;
        result.adminUserUpdated = true;
      }
    }

    const currentAssignments = await deps.userRoleRepository.listRolesByUserId(
      adminUser.id,
    );
    const roleIds = currentAssignments.map((assignment) => assignment.roleId);
    const hasExactAdminRoleOnly =
      roleIds.length === 1 && roleIds[0] === deps.adminRoleId;
    if (!hasExactAdminRoleOnly) {
      result.adminRoleAssignedToAdminUser = true;
      await deps.userRoleRepository.setUserRoles(adminUser.id, [
        deps.adminRoleId,
      ]);
    }

    const users = await deps.userRepository.list();
    for (const user of users) {
      if (user.id === adminUser.id) {
        continue;
      }
      const assignments = await deps.userRoleRepository.listRolesByUserId(
        user.id,
      );
      const userRoleIds = assignments.map((assignment) => assignment.roleId);
      if (!userRoleIds.includes(deps.adminRoleId)) {
        continue;
      }
      const nextRoleIds = uniqueIds(
        userRoleIds.filter((roleId) => roleId !== deps.adminRoleId),
      );
      await deps.userRoleRepository.setUserRoles(user.id, nextRoleIds);
    }

    return result;
  });
};

/**
 * Ensures admin user's htshadow entry has the correct password hash.
 * Returns true if the hash was updated, false if already correct.
 */
export const ensureAdminHtshadowEntry = async (input: {
  htshadowPath: string;
  adminUsername: string;
  adminPassword: string;
  map: Map<string, string>;
}): Promise<boolean> => {
  const currentHash = input.map.get(input.adminUsername);
  const isCurrentValid =
    currentHash != null
      ? await bcrypt.compare(input.adminPassword, currentHash)
      : false;
  if (isCurrentValid) {
    return false;
  }
  const nextHash = await bcrypt.hash(input.adminPassword, BCRYPT_SALT_ROUNDS);
  input.map.set(input.adminUsername, nextHash);
  await writeHtshadowMap(input.htshadowPath, input.map);
  return true;
};
