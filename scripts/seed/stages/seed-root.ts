import {
  BCRYPT_SALT_ROUNDS,
  ROOT_PERMISSION,
  ROOT_ROLE_NAME,
} from "../constants";
import {
  mapPermissionsByKey,
  permissionKey,
  type SeedContext,
  type SeedStageResult,
} from "../stage-types";

const deriveRootName = (email: string): string => {
  const local = email.split("@")[0]?.trim();
  if (local && local.length > 0) {
    return local.charAt(0).toUpperCase() + local.slice(1);
  }
  return "Root User";
};

const parseHtshadowLines = (input: string): Map<string, string> => {
  const lines = input.split(/\r?\n/).map((line) => line.trim());
  const out = new Map<string, string>();
  for (const line of lines) {
    if (!line) {
      continue;
    }
    const [email, hash] = line.split(":", 2);
    if (!email || !hash) {
      continue;
    }
    out.set(email.trim(), hash.trim());
  }
  return out;
};

const uniqueRoleIds = (roles: string[]): string[] => {
  const set = new Set<string>();
  const out: string[] = [];
  for (const roleId of roles) {
    if (!set.has(roleId)) {
      set.add(roleId);
      out.push(roleId);
    }
  }
  return out;
};

export async function runSeedRoot(ctx: SeedContext): Promise<SeedStageResult> {
  const roles = await ctx.repos.roleRepository.list();
  let rootRole = roles.find((role) => role.name === ROOT_ROLE_NAME) ?? null;

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const notes: string[] = [];

  const permissions = await ctx.repos.permissionRepository.list();
  const permissionsByKey = mapPermissionsByKey(permissions);
  const rootPermissionKey = permissionKey(ROOT_PERMISSION);
  let rootPermission = permissionsByKey.get(rootPermissionKey) ?? null;

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

  if (!rootPermission) {
    if (!ctx.args.dryRun) {
      rootPermission =
        await ctx.repos.permissionRepository.create(ROOT_PERMISSION);
    }
    created += 1;
  } else if (rootPermission.isRoot === true) {
    skipped += 1;
  } else if (ctx.repos.permissionRepository.updateIsRoot) {
    if (!ctx.args.dryRun) {
      await ctx.repos.permissionRepository.updateIsRoot(
        rootPermission.id,
        true,
      );
    }
    rootPermission = { ...rootPermission, isRoot: true };
    updated += 1;
  }

  if (!rootRole) {
    notes.push("Dry-run prevented root role assignment verification.");
  } else {
    if (!rootPermission) {
      throw new Error("Root permission missing after bootstrap step.");
    }

    const assignments =
      await ctx.repos.rolePermissionRepository.listPermissionsByRoleId(
        rootRole.id,
      );
    const permissionIds = assignments.map(
      (assignment) => assignment.permissionId,
    );
    const assignmentSet = new Set(permissionIds);

    if (!assignmentSet.has(rootPermission.id)) {
      const nextPermissionIds = uniqueRoleIds([
        ...permissionIds,
        rootPermission.id,
      ]);
      if (!ctx.args.dryRun) {
        await ctx.repos.rolePermissionRepository.setRolePermissions(
          rootRole.id,
          nextPermissionIds,
        );
      }
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  const rootUserEmail = ctx.root.user;
  let rootUser = await ctx.repos.userRepository.findByEmail(rootUserEmail);
  if (!rootUser) {
    if (!ctx.args.dryRun) {
      rootUser = await ctx.repos.userRepository.create({
        email: rootUserEmail,
        name: deriveRootName(rootUserEmail),
      });
    }
    created += 1;
  } else {
    skipped += 1;
  }

  if (!rootRole || !rootUser) {
    notes.push("Dry-run prevented root role assignment to root user.");
  } else {
    const userAssignments =
      await ctx.repos.userRoleRepository.listRolesByUserId(rootUser.id);
    const currentRoleIds = userAssignments.map(
      (assignment) => assignment.roleId,
    );
    const nextRoleIds = uniqueRoleIds([rootRole.id, ...currentRoleIds]);
    const hasRootRole = currentRoleIds.includes(rootRole.id);

    if (!hasRootRole) {
      if (!ctx.args.dryRun) {
        await ctx.repos.userRoleRepository.setUserRoles(
          rootUser.id,
          nextRoleIds,
        );
      }
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  const rootPasswordHash = await ctx.io.hashPassword(
    ctx.root.password,
    BCRYPT_SALT_ROUNDS,
  );

  let existingLines = new Map<string, string>();
  try {
    const data = await ctx.io.readFile(ctx.htshadowPath);
    existingLines = parseHtshadowLines(data);
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      )
    ) {
      throw error;
    }
    notes.push(`htshadow file not found. Will create: ${ctx.htshadowPath}`);
  }

  if (!ctx.args.dryRun && !rootUser) {
    throw new Error(
      `Failed to resolve root user for htshadow sync: ${rootUserEmail}`,
    );
  }

  const currentHash = existingLines.get(rootUserEmail);
  if (currentHash !== rootPasswordHash) {
    if (!ctx.args.dryRun) {
      const nextLines = new Map(existingLines);
      nextLines.set(rootUserEmail, rootPasswordHash);
      const output = [...nextLines.entries()].map(
        ([email, hash]) => `${email}:${hash}`,
      );
      await ctx.io.writeFile(ctx.htshadowPath, `${output.join("\n")}\n`);
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
    notes,
  };
}
