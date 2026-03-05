import { ROOT_PERMISSION, STANDARD_RESOURCE_ACTIONS } from "../constants";
import {
  permissionKey,
  type SeedContext,
  type SeedStageResult,
} from "../stage-types";

export async function runSeedStandardPermissions(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  const rootPermissionKey = permissionKey(ROOT_PERMISSION);
  const existing = await ctx.repos.permissionRepository.list();
  const canonicalKeys = new Set(
    STANDARD_RESOURCE_ACTIONS.map((permission) => permissionKey(permission)),
  );
  const existingByKey = new Map(
    existing.map((permission) => [permissionKey(permission), permission]),
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const permission of STANDARD_RESOURCE_ACTIONS) {
    const key = permissionKey(permission);
    const existingPermission = existingByKey.get(key);
    if (existingPermission) {
      if (existingPermission.isRoot === true) {
        if (!ctx.repos.permissionRepository.updateIsRoot) {
          throw new Error(
            "permissionRepository.updateIsRoot is required for strict permission normalization",
          );
        }
        if (!ctx.args.dryRun) {
          await ctx.repos.permissionRepository.updateIsRoot(
            existingPermission.id,
            false,
          );
        }
        updated += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    if (!ctx.args.dryRun) {
      await ctx.repos.permissionRepository.create(permission);
    }
    created += 1;
  }

  const stalePermissionIds = existing
    .filter((permission) => {
      const key = permissionKey(permission);
      if (key === rootPermissionKey) {
        return false;
      }
      return !canonicalKeys.has(key);
    })
    .map((permission) => permission.id);

  if (stalePermissionIds.length > 0) {
    if (!ctx.repos.permissionRepository.deleteByIds) {
      throw new Error(
        "permissionRepository.deleteByIds is required for strict permission normalization",
      );
    }
    if (!ctx.args.dryRun) {
      await ctx.repos.permissionRepository.deleteByIds(stalePermissionIds);
    }
    updated += stalePermissionIds.length;
  }

  return {
    name: "seed-standard-permissions",
    created,
    updated,
    skipped,
  };
}
