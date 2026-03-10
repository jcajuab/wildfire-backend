import { type PermissionRepository } from "#/application/ports/rbac";
import {
  ADMIN_PERMISSION,
  CANONICAL_STANDARD_RESOURCE_ACTIONS,
  canonicalPermissionKey,
} from "#/domain/rbac/canonical-permissions";

const CANONICAL_PERMISSION_SEEDS = [
  ...CANONICAL_STANDARD_RESOURCE_ACTIONS,
  ADMIN_PERMISSION,
];

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

export { CANONICAL_PERMISSION_SEEDS };
