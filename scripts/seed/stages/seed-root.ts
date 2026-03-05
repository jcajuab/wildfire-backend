import bcrypt from "bcryptjs";
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

const deriveRootName = (username: string): string => {
  const local = username.split("@")[0]?.trim();
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
    const [username, hash] = line.split(":", 2);
    if (!username || !hash) {
      continue;
    }
    out.set(username.trim().toLowerCase(), hash.trim());
  }
  return out;
};

const uniqueIds = (values: string[]): string[] => {
  const set = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!set.has(value)) {
      set.add(value);
      out.push(value);
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
  } else {
    if (!ctx.repos.permissionRepository.updateIsRoot) {
      throw new Error(
        "permissionRepository.updateIsRoot is required for root permission enforcement",
      );
    }
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
    const hasExactRootPermissionOnly =
      permissionIds.length === 1 && permissionIds[0] === rootPermission.id;

    if (!hasExactRootPermissionOnly) {
      const nextPermissionIds = [rootPermission.id];
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

    for (const role of roles) {
      if (role.id === rootRole.id) {
        continue;
      }
      const assignmentsForRole =
        await ctx.repos.rolePermissionRepository.listPermissionsByRoleId(
          role.id,
        );
      const rolePermissionIds = assignmentsForRole.map(
        (assignment) => assignment.permissionId,
      );
      if (!rolePermissionIds.includes(rootPermission.id)) {
        skipped += 1;
        continue;
      }
      const nextRolePermissionIds = uniqueIds(
        rolePermissionIds.filter(
          (permissionId) => permissionId !== rootPermission.id,
        ),
      );
      if (!ctx.args.dryRun) {
        await ctx.repos.rolePermissionRepository.setRolePermissions(
          role.id,
          nextRolePermissionIds,
        );
      }
      updated += 1;
    }
  }

  const rootUsername = ctx.root.username;
  let rootUser = await ctx.repos.userRepository.findByUsername(rootUsername);
  if (!rootUser) {
    if (!ctx.args.dryRun) {
      rootUser = await ctx.repos.userRepository.create({
        username: rootUsername,
        email: ctx.root.email,
        name: deriveRootName(rootUsername),
      });
    }
    created += 1;
  } else {
    skipped += 1;
    if (!ctx.args.dryRun) {
      const nextName = deriveRootName(rootUsername);
      const shouldUpdate =
        rootUser.name !== nextName || rootUser.email !== ctx.root.email;
      if (shouldUpdate) {
        const updatedUser = await ctx.repos.userRepository.update(rootUser.id, {
          name: nextName,
          email: ctx.root.email,
        });
        if (updatedUser) {
          rootUser = updatedUser;
        }
        updated += 1;
      }
    }
  }

  if (!rootRole || !rootUser) {
    notes.push("Dry-run prevented root role assignment to root user.");
  } else {
    const userAssignments =
      await ctx.repos.userRoleRepository.listRolesByUserId(rootUser.id);
    const currentRoleIds = userAssignments.map(
      (assignment) => assignment.roleId,
    );
    const hasExactRootRoleOnly =
      currentRoleIds.length === 1 && currentRoleIds[0] === rootRole.id;

    if (!hasExactRootRoleOnly) {
      const nextRoleIds = [rootRole.id];
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

    const users = await ctx.repos.userRepository.list();
    for (const user of users) {
      if (user.id === rootUser.id) {
        continue;
      }
      const assignmentsForUser =
        await ctx.repos.userRoleRepository.listRolesByUserId(user.id);
      const roleIdsForUser = assignmentsForUser.map(
        (assignment) => assignment.roleId,
      );
      if (!roleIdsForUser.includes(rootRole.id)) {
        skipped += 1;
        continue;
      }
      const nextRoleIds = uniqueIds(
        roleIdsForUser.filter((roleId) => roleId !== rootRole.id),
      );
      if (!ctx.args.dryRun) {
        await ctx.repos.userRoleRepository.setUserRoles(user.id, nextRoleIds);
      }
      updated += 1;
    }
  }

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
      `Failed to resolve root user for htshadow sync: ${rootUsername}`,
    );
  }

  const currentHash = existingLines.get(rootUsername);
  let isCurrentPasswordValid = false;
  if (currentHash) {
    isCurrentPasswordValid = await bcrypt.compare(
      ctx.root.password,
      currentHash,
    );
  }
  if (!isCurrentPasswordValid) {
    const rootPasswordHash = await ctx.io.hashPassword(
      ctx.root.password,
      BCRYPT_SALT_ROUNDS,
    );
    if (!ctx.args.dryRun) {
      const nextLines = new Map(existingLines);
      nextLines.set(rootUsername, rootPasswordHash);
      const output = [...nextLines.entries()].map(
        ([username, hash]) => `${username}:${hash}`,
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
