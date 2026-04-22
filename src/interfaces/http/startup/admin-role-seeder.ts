import {
  type PermissionRepository,
  type RolePermissionRepository,
  type RoleRepository,
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

export interface AdminRolePermissionSyncMetrics {
  createdAdminRole: boolean;
  createdAdminPermission: boolean;
  assignedAdminPermissionToAdminRole: boolean;
  adminPermissionPurgedFromOtherRoles: number;
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
