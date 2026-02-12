import { SUPER_ADMIN_PERMISSION, SUPER_ADMIN_ROLE_NAME } from "../constants";
import {
  mapPermissionsByKey,
  permissionKey,
  type SeedContext,
  type SeedStageResult,
} from "../stage-types";

export async function runSeedSuperAdmin(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  const roles = await ctx.repos.roleRepository.list();
  let superAdminRole =
    roles.find((role) => role.name === SUPER_ADMIN_ROLE_NAME) ?? null;

  let created = 0;
  let updated = 0;
  let skipped = 0;

  if (!superAdminRole) {
    if (!ctx.args.dryRun) {
      superAdminRole = await ctx.repos.roleRepository.create({
        name: SUPER_ADMIN_ROLE_NAME,
        description: "All access",
        isSystem: true,
      });
    }
    created += 1;
  } else {
    skipped += 1;
  }

  const permissions = await ctx.repos.permissionRepository.list();
  const permissionsByKey = mapPermissionsByKey(permissions);

  const wildcardKey = permissionKey(SUPER_ADMIN_PERMISSION);
  let wildcardPermission = permissionsByKey.get(wildcardKey) ?? null;

  if (!wildcardPermission) {
    if (!ctx.args.dryRun) {
      wildcardPermission = await ctx.repos.permissionRepository.create(
        SUPER_ADMIN_PERMISSION,
      );
    }
    created += 1;
  } else {
    skipped += 1;
  }

  if (!superAdminRole || !wildcardPermission) {
    return {
      name: "seed-super-admin",
      created,
      updated,
      skipped,
      notes: ["Dry-run prevented role/permission assignment verification"],
    };
  }

  const assignments =
    await ctx.repos.rolePermissionRepository.listPermissionsByRoleId(
      superAdminRole.id,
    );
  const assignmentIds = new Set(
    assignments.map((assignment) => assignment.permissionId),
  );

  if (!assignmentIds.has(wildcardPermission.id)) {
    assignmentIds.add(wildcardPermission.id);
    if (!ctx.args.dryRun) {
      await ctx.repos.rolePermissionRepository.setRolePermissions(
        superAdminRole.id,
        Array.from(assignmentIds),
      );
    }
    updated += 1;
  } else {
    skipped += 1;
  }

  return {
    name: "seed-super-admin",
    created,
    updated,
    skipped,
  };
}
