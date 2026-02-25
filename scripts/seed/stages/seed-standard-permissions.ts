import { STANDARD_RESOURCE_ACTIONS } from "../constants";
import {
  permissionKey,
  type SeedContext,
  type SeedStageResult,
} from "../stage-types";

export async function runSeedStandardPermissions(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  const existing = await ctx.repos.permissionRepository.list();
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
        if (!ctx.args.dryRun && ctx.repos.permissionRepository.updateIsRoot) {
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

  return {
    name: "seed-standard-permissions",
    created,
    updated,
    skipped,
  };
}
