import {
  type PermissionRepository,
  type RolePermissionRepository,
  type RoleRepository,
} from "#/application/ports/rbac";
import {
  ADMIN_PERMISSION,
  CANONICAL_STANDARD_RESOURCE_ACTIONS,
  canonicalPermissionKey,
} from "#/domain/rbac/canonical-permissions";
import { PREDEFINED_SYSTEM_ROLE_TEMPLATES } from "#/domain/rbac/system-role-templates";

// --- Permission seeder ---

const CANONICAL_PERMISSION_SEEDS = [
  ...CANONICAL_STANDARD_RESOURCE_ACTIONS,
  ADMIN_PERMISSION,
];

export { CANONICAL_PERMISSION_SEEDS };

export interface PermissionSyncMetrics {
  created: number;
  updated: number;
  removed: number;
  unchanged: number;
}

/**
 * Syncs canonical permissions to the database.
 * - Creates missing permissions
 * - Updates isAdmin flag if incorrect
 * - Removes stale permissions not in canonical set
 */
export const ensureCanonicalStandardPermissions = async (deps: {
  permissionRepository: PermissionRepository;
}): Promise<PermissionSyncMetrics> => {
  const result: PermissionSyncMetrics = {
    created: 0,
    updated: 0,
    removed: 0,
    unchanged: 0,
  };

  const existing = await deps.permissionRepository.list();
  const existingByKey = new Map(
    existing.map((permission) => [
      canonicalPermissionKey(permission),
      permission,
    ]),
  );
  const canonicalKeys = new Set(
    CANONICAL_PERMISSION_SEEDS.map((permission) =>
      canonicalPermissionKey(permission),
    ),
  );

  for (const permission of CANONICAL_PERMISSION_SEEDS) {
    const key = canonicalPermissionKey(permission);
    const existingPermission = existingByKey.get(key);
    if (!existingPermission) {
      await deps.permissionRepository.create(permission);
      result.created += 1;
      continue;
    }

    const expectedIsAdmin =
      existingPermission.resource === ADMIN_PERMISSION.resource &&
      existingPermission.action === ADMIN_PERMISSION.action;
    if (existingPermission.isAdmin !== expectedIsAdmin) {
      if (!deps.permissionRepository.updateIsAdmin) {
        throw new Error(
          "permissionRepository.updateIsAdmin is required for strict permission normalization",
        );
      }
      await deps.permissionRepository.updateIsAdmin(
        existingPermission.id,
        expectedIsAdmin,
      );
      result.updated += 1;
      continue;
    }

    result.unchanged += 1;
  }

  const stalePermissionIds = existing
    .filter(
      (permission) => !canonicalKeys.has(canonicalPermissionKey(permission)),
    )
    .map((permission) => permission.id);

  if (stalePermissionIds.length === 0) {
    return result;
  }

  if (!deps.permissionRepository.deleteByIds) {
    throw new Error(
      "permissionRepository.deleteByIds is required for strict permission normalization",
    );
  }
  await deps.permissionRepository.deleteByIds(stalePermissionIds);
  result.removed += stalePermissionIds.length;
  return result;
};

// --- System role seeder ---

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
      });
      rolesByName.set(role.name, role);
      result.createdSystemRoles += 1;
    } else if (role.description !== template.description) {
      const updatedRole = await deps.roleRepository.update(role.id, {
        description: template.description,
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
