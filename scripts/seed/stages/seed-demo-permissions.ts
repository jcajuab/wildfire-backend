import {
  CANONICAL_STANDARD_RESOURCE_ACTIONS,
  canonicalPermissionKey,
  ROOT_PERMISSION,
} from "#/domain/rbac/canonical-permissions";
import {
  permissionKey,
  type SeedContext,
  type SeedStageResult,
} from "../stage-types";

export async function runSeedDemoPermissions(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const notes: string[] = [];

  const permissions = await ctx.repos.permissionRepository.list();
  const permissionsByKey = new Map(
    permissions.map((permission) => [permissionKey(permission), permission]),
  );

  const canonicalPermissions = [
    ...CANONICAL_STANDARD_RESOURCE_ACTIONS,
    ROOT_PERMISSION,
  ];

  const canonicalKeys = new Set(
    canonicalPermissions.map((permission) =>
      canonicalPermissionKey(permission),
    ),
  );

  for (const permission of canonicalPermissions) {
    const key = permissionKey(permission);
    const existingPermission = permissionsByKey.get(key);

    if (!existingPermission) {
      if (!ctx.args.dryRun) {
        await ctx.repos.permissionRepository.create({
          resource: permission.resource,
          action: permission.action,
          isRoot:
            permission.resource === ROOT_PERMISSION.resource &&
            permission.action === ROOT_PERMISSION.action,
        });
      }
      created += 1;
      continue;
    }

    const expectedIsRoot =
      permission.resource === ROOT_PERMISSION.resource &&
      permission.action === ROOT_PERMISSION.action;
    if (existingPermission.isRoot !== expectedIsRoot) {
      if (!ctx.args.dryRun) {
        if (!ctx.repos.permissionRepository.updateIsRoot) {
          throw new Error(
            "Permission repository does not support root-flag updates.",
          );
        }
        await ctx.repos.permissionRepository.updateIsRoot(
          existingPermission.id,
          expectedIsRoot,
        );
      }
      updated += 1;
      continue;
    }

    skipped += 1;
  }

  const stalePermissionIds = permissions
    .filter((permission) => !canonicalKeys.has(permissionKey(permission)))
    .map((permission) => permission.id);

  if (stalePermissionIds.length === 0) {
    if (ctx.args.dryRun) {
      notes.push("Dry-run mode: no writes performed.");
    }
    return {
      name: "seed-demo-permissions",
      created,
      updated,
      skipped,
      notes,
    };
  }

  if (!ctx.args.dryRun) {
    if (!ctx.repos.permissionRepository.deleteByIds) {
      throw new Error(
        "Permission repository does not support permission cleanup during seed sync.",
      );
    }
    await ctx.repos.permissionRepository.deleteByIds(stalePermissionIds);
    updated += stalePermissionIds.length;
    notes.push(`Removed ${stalePermissionIds.length} stale permission(s).`);
  } else {
    notes.push(
      `Dry-run mode: would remove ${stalePermissionIds.length} stale permissions.`,
    );
  }

  return {
    name: "seed-demo-permissions",
    created,
    updated,
    skipped,
    notes,
  };
}
