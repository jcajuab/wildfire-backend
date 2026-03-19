import {
  type CredentialsRepository,
  type PasswordHasher,
} from "#/application/ports/auth";
import {
  type PermissionRepository,
  type RolePermissionRepository,
  type RoleRepository,
  type UserRepository,
  type UserRoleRepository,
} from "#/application/ports/rbac";
import {
  ADMIN_PERMISSION,
  ADMIN_ROLE_NAME,
} from "#/domain/rbac/canonical-permissions";
import { db } from "#/infrastructure/db/client";

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
 * Phase 1: Find-or-create admin user.
 * - Finds admin by role (not username). If found, skips creation (env vars ignored).
 * - If no admin found, creates from env vars and stores password hash in DB.
 * Phase 2: Purge admin role from unauthorized users (runs on EVERY boot).
 */
export const ensureAdminUser = async (deps: {
  userRepository: UserRepository;
  userRoleRepository: UserRoleRepository;
  adminRoleId: string;
  adminUsername: string;
  adminEmail: string | null;
  adminPassword: string;
  dbCredentialsRepository: CredentialsRepository;
  passwordHasher: PasswordHasher;
}): Promise<AdminUserSyncMetrics> => {
  return db.transaction(async () => {
    const result: AdminUserSyncMetrics = {
      adminUserCreated: false,
      adminUserUpdated: false,
      adminRoleAssignedToAdminUser: false,
    };

    // Phase 1: Find admin by role, or create on first boot
    const adminUserIds = await deps.userRoleRepository.listUserIdsByRoleId(
      deps.adminRoleId,
    );
    const firstAdminUserId = adminUserIds[0];
    let adminUser = firstAdminUserId
      ? await deps.userRepository.findById(firstAdminUserId)
      : null;

    if (!adminUser) {
      // First boot: create admin from env vars
      const expectedName = deriveUserName(deps.adminUsername);
      adminUser = await deps.userRepository.create({
        username: deps.adminUsername,
        email: deps.adminEmail,
        name: expectedName,
        isActive: true,
      });
      result.adminUserCreated = true;

      // Assign admin role
      await deps.userRoleRepository.setUserRoles(adminUser.id, [
        deps.adminRoleId,
      ]);
      result.adminRoleAssignedToAdminUser = true;

      // Create DB credential
      const passwordHash = await deps.passwordHasher.hash(deps.adminPassword);
      await deps.dbCredentialsRepository.createPasswordHash(
        adminUser.username,
        passwordHash,
      );
    }
    // If admin found by role: skip creation, do NOT update from env vars

    // Phase 2: Purge admin role from unauthorized users (ALWAYS runs)
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
