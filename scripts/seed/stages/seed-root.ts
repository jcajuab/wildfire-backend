import { ROOT_PERMISSION, ROOT_ROLE_NAME } from "../constants";
import {
  mapPermissionsByKey,
  permissionKey,
  type SeedContext,
  type SeedStageResult,
} from "../stage-types";

export async function runSeedRoot(ctx: SeedContext): Promise<SeedStageResult> {
  const roles = await ctx.repos.roleRepository.list();
  let rootRole = roles.find((role) => role.name === ROOT_ROLE_NAME) ?? null;

  let created = 0;
  let updated = 0;
  let skipped = 0;

  if (!rootRole) {
    if (!ctx.args.dryRun) {
      rootRole = await ctx.repos.roleRepository.create({
        name: ROOT_ROLE_NAME,
        description: "Global root access",
        isSystem: true,
      });
    }
    created += 1;
  } else {
    skipped += 1;
  }

  const permissions = await ctx.repos.permissionRepository.list();
  const permissionsByKey = mapPermissionsByKey(permissions);

  const rootPermissionKey = permissionKey(ROOT_PERMISSION);
  let rootPermission = permissionsByKey.get(rootPermissionKey) ?? null;

  if (!rootPermission) {
    if (!ctx.args.dryRun) {
      rootPermission =
        await ctx.repos.permissionRepository.create(ROOT_PERMISSION);
    }
    created += 1;
  } else {
    if (rootPermission.isRoot === true) {
      skipped += 1;
    } else {
      if (!ctx.args.dryRun && ctx.repos.permissionRepository.updateIsRoot) {
        await ctx.repos.permissionRepository.updateIsRoot(
          rootPermission.id,
          true,
        );
      }
      rootPermission = { ...rootPermission, isRoot: true };
      updated += 1;
    }
  }

  if (!rootRole || !rootPermission) {
    return {
      name: "seed-root",
      created,
      updated,
      skipped,
      notes: ["Dry-run prevented role/permission assignment verification"],
    };
  }

  const assignments =
    await ctx.repos.rolePermissionRepository.listPermissionsByRoleId(
      rootRole.id,
    );
  const assignmentIds = new Set(
    assignments.map((assignment) => assignment.permissionId),
  );

  if (!assignmentIds.has(rootPermission.id)) {
    assignmentIds.add(rootPermission.id);
    if (!ctx.args.dryRun) {
      await ctx.repos.rolePermissionRepository.setRolePermissions(
        rootRole.id,
        Array.from(assignmentIds),
      );
    }
    updated += 1;
  } else {
    skipped += 1;
  }

  return {
    name: "seed-root",
    created,
    updated,
    skipped,
  };
}
