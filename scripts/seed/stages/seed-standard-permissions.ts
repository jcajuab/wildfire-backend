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
  const existingKeys = new Set(
    existing.map((permission) => permissionKey(permission)),
  );

  let created = 0;
  let skipped = 0;
  for (const permission of STANDARD_RESOURCE_ACTIONS) {
    const key = permissionKey(permission);
    if (existingKeys.has(key)) {
      skipped += 1;
      continue;
    }

    if (!ctx.args.dryRun) {
      await ctx.repos.permissionRepository.create(permission);
    }
    created += 1;
    existingKeys.add(key);
  }

  return {
    name: "seed-standard-permissions",
    created,
    updated: 0,
    skipped,
  };
}
