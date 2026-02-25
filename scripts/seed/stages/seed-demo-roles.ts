import { EDITOR_ROLE_NAME, VIEWER_ROLE_NAME } from "../constants";
import { type SeedContext, type SeedStageResult } from "../stage-types";

const sameIdSet = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
};

const resolvePermissionIds = (ctx: {
  permissions: Array<{
    id: string;
    resource: string;
    action: string;
    isRoot?: boolean;
  }>;
}) => {
  const readPermissionIds = ctx.permissions
    .filter(
      (permission) =>
        permission.action === "read" && permission.isRoot !== true,
    )
    .map((permission) => permission.id);

  const editorPermissionIds = ctx.permissions
    .filter(
      (permission) =>
        permission.isRoot !== true &&
        (permission.action === "read" ||
          permission.action === "create" ||
          permission.action === "update" ||
          permission.action === "delete" ||
          permission.action === "download"),
    )
    .map((permission) => permission.id);

  return { readPermissionIds, editorPermissionIds };
};

const upsertRolePermissions = async (input: {
  ctx: SeedContext;
  roleId: string;
  desiredPermissionIds: string[];
}): Promise<"updated" | "skipped"> => {
  const current =
    await input.ctx.repos.rolePermissionRepository.listPermissionsByRoleId(
      input.roleId,
    );
  const currentPermissionIds = current.map(
    (assignment) => assignment.permissionId,
  );

  if (sameIdSet(currentPermissionIds, input.desiredPermissionIds)) {
    return "skipped";
  }

  if (!input.ctx.args.dryRun) {
    await input.ctx.repos.rolePermissionRepository.setRolePermissions(
      input.roleId,
      input.desiredPermissionIds,
    );
  }

  return "updated";
};

export async function runSeedDemoRoles(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  const permissions = await ctx.repos.permissionRepository.list();
  const { readPermissionIds, editorPermissionIds } = resolvePermissionIds({
    permissions,
  });

  const roles = await ctx.repos.roleRepository.list();
  let editorRole = roles.find((role) => role.name === EDITOR_ROLE_NAME) ?? null;
  let viewerRole = roles.find((role) => role.name === VIEWER_ROLE_NAME) ?? null;

  let created = 0;
  let updated = 0;
  let skipped = 0;

  if (!editorRole) {
    if (!ctx.args.dryRun) {
      editorRole = await ctx.repos.roleRepository.create({
        name: EDITOR_ROLE_NAME,
        description: "Create and edit content",
        isSystem: false,
      });
    }
    created += 1;
  } else {
    skipped += 1;
  }

  if (!viewerRole) {
    if (!ctx.args.dryRun) {
      viewerRole = await ctx.repos.roleRepository.create({
        name: VIEWER_ROLE_NAME,
        description: "Read-only access",
        isSystem: false,
      });
    }
    created += 1;
  } else {
    skipped += 1;
  }

  const notes: string[] = [];
  if (!editorRole || !viewerRole) {
    notes.push("Dry-run prevented permission reconciliation for demo roles");
    return {
      name: "seed-demo-roles",
      created,
      updated,
      skipped,
      notes,
    };
  }

  const editorOutcome = await upsertRolePermissions({
    ctx,
    roleId: editorRole.id,
    desiredPermissionIds: editorPermissionIds,
  });

  if (editorOutcome === "updated") {
    updated += 1;
  } else {
    skipped += 1;
  }

  const viewerOutcome = await upsertRolePermissions({
    ctx,
    roleId: viewerRole.id,
    desiredPermissionIds: readPermissionIds,
  });

  if (viewerOutcome === "updated") {
    updated += 1;
  } else {
    skipped += 1;
  }

  return {
    name: "seed-demo-roles",
    created,
    updated,
    skipped,
  };
}
