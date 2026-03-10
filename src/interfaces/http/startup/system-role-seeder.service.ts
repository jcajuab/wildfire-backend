import {
  type PermissionRepository,
  type RolePermissionRepository,
  type RoleRepository,
} from "#/application/ports/rbac";
import { canonicalPermissionKey } from "#/domain/rbac/canonical-permissions";
import { PREDEFINED_SYSTEM_ROLE_TEMPLATES } from "#/domain/rbac/system-role-templates";

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

/**
 * Checks if actual ID set exactly matches expected set (order-independent).
 */
export const hasExactIdSet = (
  actual: readonly string[],
  expected: readonly string[],
): boolean => {
  if (actual.length !== expected.length) {
    return false;
  }
  const expectedSet = new Set(expected);
  for (const value of actual) {
    if (!expectedSet.has(value)) {
      return false;
    }
  }
  return true;
};

export interface SystemRoleSyncMetrics {
  createdSystemRoles: number;
  updatedSystemRoles: number;
  reconciledSystemRolePermissionSets: number;
}

/**
 * Syncs predefined system roles from templates.
 * Creates missing roles, updates descriptions, and reconciles permission sets.
 */
export const ensurePredefinedSystemRoles = async (deps: {
  roleRepository: RoleRepository;
  permissionRepository: PermissionRepository;
  rolePermissionRepository: RolePermissionRepository;
}): Promise<SystemRoleSyncMetrics> => {
  const result: SystemRoleSyncMetrics = {
    createdSystemRoles: 0,
    updatedSystemRoles: 0,
    reconciledSystemRolePermissionSets: 0,
  };

  const permissions = await deps.permissionRepository.list();
  const permissionIdByKey = new Map(
    permissions.map((permission) => [
      canonicalPermissionKey(permission),
      permission.id,
    ]),
  );
  const roles = await deps.roleRepository.list();
  const rolesByName = new Map(roles.map((role) => [role.name, role]));

  for (const template of PREDEFINED_SYSTEM_ROLE_TEMPLATES) {
    const desiredPermissionIds = template.permissionKeys.map((key) => {
      const permissionId = permissionIdByKey.get(key);
      if (!permissionId) {
        throw new Error(
          `Cannot reconcile predefined system role '${template.name}'. Missing permission '${key}'.`,
        );
      }
      return permissionId;
    });

    let role = rolesByName.get(template.name) ?? null;
    if (!role) {
      role = await deps.roleRepository.create({
        name: template.name,
        description: template.description,
        isSystem: true,
      });
      rolesByName.set(role.name, role);
      result.createdSystemRoles += 1;
    } else if (
      role.description !== template.description ||
      role.isSystem !== true
    ) {
      const updatedRole = await deps.roleRepository.update(role.id, {
        description: template.description,
        isSystem: true,
      });
      if (!updatedRole) {
        throw new Error(
          `Cannot reconcile predefined system role '${template.name}'. Role disappeared during update.`,
        );
      }
      role = updatedRole;
      rolesByName.set(role.name, role);
      result.updatedSystemRoles += 1;
    }

    const existingAssignments =
      await deps.rolePermissionRepository.listPermissionsByRoleId(role.id);
    const existingPermissionIds = existingAssignments.map(
      (assignment) => assignment.permissionId,
    );
    if (!hasExactIdSet(existingPermissionIds, desiredPermissionIds)) {
      await deps.rolePermissionRepository.setRolePermissions(
        role.id,
        uniqueIds(desiredPermissionIds),
      );
      result.reconciledSystemRolePermissionSets += 1;
    }
  }

  return result;
};
