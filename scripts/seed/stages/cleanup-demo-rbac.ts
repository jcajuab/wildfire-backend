import { DEMO_ROLE_PREFIX, DEMO_USER_PREFIX } from "../constants";
import {
  normalizeHtshadowUsername,
  readHtshadowMap,
  serializeHtshadow,
} from "../htshadow";
import { type SeedContext, type SeedStageResult } from "../stage-types";

export async function runCleanupDemoRbac(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  const users = await ctx.repos.userRepository.list();
  const roles = await ctx.repos.roleRepository.list();
  const demoUsers = users.filter((user) =>
    user.username.startsWith(DEMO_USER_PREFIX),
  );
  const demoRoles = roles.filter((role) =>
    role.name.startsWith(DEMO_ROLE_PREFIX),
  );

  let removedAssignments = 0;
  let removedEntities = 0;
  let skipped = 0;
  const notes: string[] = [];

  if (ctx.args.dryRun) {
    return {
      name: "cleanup-demo-rbac",
      created: 0,
      updated: demoUsers.length + demoRoles.length,
      skipped,
      notes: [
        "Dry-run mode: demo users, roles, and credentials were not removed.",
      ],
    };
  }

  for (const user of demoUsers) {
    await ctx.repos.userRoleRepository.setUserRoles(user.id, []);
    removedAssignments += 1;
    const removed = await ctx.repos.userRepository.delete(user.id);
    if (removed) {
      removedEntities += 1;
    } else {
      skipped += 1;
    }
  }

  for (const role of demoRoles) {
    await ctx.repos.rolePermissionRepository.setRolePermissions(role.id, []);
    removedAssignments += 1;
    const removed = await ctx.repos.roleRepository.delete(role.id);
    if (removed) {
      removedEntities += 1;
    } else {
      skipped += 1;
    }
  }

  const htshadowEntries = await readHtshadowMap({
    path: ctx.htshadowPath,
    readFile: ctx.io.readFile,
  });
  let removedCredentials = 0;
  const targetUsernames = new Set(
    demoUsers.map((user) => normalizeHtshadowUsername(user.username)),
  );
  for (const username of htshadowEntries.keys()) {
    if (username.startsWith(DEMO_USER_PREFIX)) {
      targetUsernames.add(username);
    }
  }
  for (const username of targetUsernames) {
    if (htshadowEntries.delete(username)) {
      removedCredentials += 1;
    }
  }
  if (removedCredentials > 0) {
    await ctx.io.writeFile(
      ctx.htshadowPath,
      serializeHtshadow(htshadowEntries),
    );
    notes.push(`Removed ${removedCredentials} demo credential entries.`);
  }

  return {
    name: "cleanup-demo-rbac",
    created: 0,
    updated: removedAssignments + removedEntities + removedCredentials,
    skipped,
    notes,
  };
}
