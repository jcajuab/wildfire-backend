import bcrypt from "bcryptjs";
import { DEMO_ROLES, DEMO_USERS } from "../fixtures";
import {
  normalizeHtshadowUsername,
  readHtshadowMap,
  serializeHtshadow,
} from "../htshadow";
import {
  mapPermissionsByKey,
  type SeedContext,
  type SeedStageResult,
} from "../stage-types";

const BCRYPT_SALT_ROUNDS = 10;

const sameIdSet = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  left.length === right.length && left.every((value) => right.includes(value));

export async function runSeedDemoRbac(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const notes: string[] = [];

  const permissions = await ctx.repos.permissionRepository.list();
  const permissionsByKey = mapPermissionsByKey(permissions);

  const existingRoles = await ctx.repos.roleRepository.list();
  const rolesByName = new Map(existingRoles.map((role) => [role.name, role]));
  const roleIdsByKey = new Map<string, string>();

  for (const roleFixture of DEMO_ROLES) {
    let role = rolesByName.get(roleFixture.name) ?? null;
    if (!role) {
      if (!ctx.args.dryRun) {
        role = await ctx.repos.roleRepository.create({
          name: roleFixture.name,
          description: roleFixture.description,
          isSystem: false,
        });
      } else {
        role = {
          id: `dry-run:${roleFixture.key}`,
          name: roleFixture.name,
          description: roleFixture.description,
          isSystem: false,
        };
      }
      created += 1;
    } else if (role.description !== roleFixture.description) {
      if (!ctx.args.dryRun) {
        const updatedRole = await ctx.repos.roleRepository.update(role.id, {
          description: roleFixture.description,
        });
        if (updatedRole) {
          role = updatedRole;
        }
      }
      updated += 1;
    } else {
      skipped += 1;
    }

    roleIdsByKey.set(roleFixture.key, role.id);

    const permissionIds = roleFixture.permissionKeys.map((key) => {
      const permission = permissionsByKey.get(key);
      if (!permission) {
        throw new Error(
          `Missing canonical permission for demo role seeding: ${key}`,
        );
      }
      return permission.id;
    });

    const currentAssignments =
      await ctx.repos.rolePermissionRepository.listPermissionsByRoleId(role.id);
    const currentPermissionIds = currentAssignments.map(
      (assignment) => assignment.permissionId,
    );
    if (!sameIdSet(currentPermissionIds, permissionIds)) {
      if (!ctx.args.dryRun) {
        await ctx.repos.rolePermissionRepository.setRolePermissions(
          role.id,
          permissionIds,
        );
      }
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  const usersByUsername = new Map(
    (await ctx.repos.userRepository.list()).map((user) => [
      user.username,
      user,
    ]),
  );

  for (const userFixture of DEMO_USERS) {
    let user =
      usersByUsername.get(normalizeHtshadowUsername(userFixture.username)) ??
      null;
    if (!user) {
      if (!ctx.args.dryRun) {
        user = await ctx.repos.userRepository.create({
          username: userFixture.username,
          email: userFixture.email,
          name: userFixture.name,
          isActive: true,
        });
      } else {
        user = {
          id: `dry-run:${userFixture.username}`,
          username: userFixture.username,
          email: userFixture.email,
          name: userFixture.name,
          isActive: true,
        };
      }
      created += 1;
    } else {
      const shouldUpdate =
        user.name !== userFixture.name ||
        user.email !== userFixture.email ||
        user.isActive !== true;
      if (shouldUpdate) {
        if (!ctx.args.dryRun) {
          const updatedUser = await ctx.repos.userRepository.update(user.id, {
            name: userFixture.name,
            email: userFixture.email,
            isActive: true,
          });
          if (updatedUser) {
            user = updatedUser;
          }
        }
        updated += 1;
      } else {
        skipped += 1;
      }
    }

    const expectedRoleIds = userFixture.roleKeys.map((roleKey) => {
      const roleId = roleIdsByKey.get(roleKey);
      if (!roleId) {
        throw new Error(
          `Missing demo role id while assigning user roles: ${roleKey}`,
        );
      }
      return roleId;
    });
    const currentAssignments =
      await ctx.repos.userRoleRepository.listRolesByUserId(user.id);
    const currentRoleIds = currentAssignments.map(
      (assignment) => assignment.roleId,
    );
    if (!sameIdSet(currentRoleIds, expectedRoleIds)) {
      if (!ctx.args.dryRun) {
        await ctx.repos.userRoleRepository.setUserRoles(
          user.id,
          expectedRoleIds,
        );
      }
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  const htshadowEntries = await readHtshadowMap({
    path: ctx.htshadowPath,
    readFile: ctx.io.readFile,
  });
  let shouldWriteHtshadow = false;

  for (const userFixture of DEMO_USERS) {
    const username = normalizeHtshadowUsername(userFixture.username);
    const currentHash = htshadowEntries.get(username);
    const isCurrentValid =
      currentHash != null
        ? await bcrypt.compare(userFixture.password, currentHash)
        : false;
    if (isCurrentValid) {
      skipped += 1;
      continue;
    }

    const nextHash = await ctx.io.hashPassword(
      userFixture.password,
      BCRYPT_SALT_ROUNDS,
    );
    if (!ctx.args.dryRun) {
      htshadowEntries.set(username, nextHash);
      shouldWriteHtshadow = true;
    }
    if (currentHash) {
      updated += 1;
    } else {
      created += 1;
    }
  }

  if (shouldWriteHtshadow) {
    await ctx.io.writeFile(
      ctx.htshadowPath,
      serializeHtshadow(htshadowEntries),
    );
    notes.push(`Updated demo credentials in ${ctx.htshadowPath}`);
  } else if (ctx.args.dryRun) {
    notes.push("Dry-run mode: htshadow entries were not written.");
  }

  return {
    name: "seed-demo-rbac",
    created,
    updated,
    skipped,
    notes,
  };
}
