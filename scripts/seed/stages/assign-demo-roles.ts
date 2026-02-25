import {
  DUMMY_USERS,
  EDITOR_ROLE_NAME,
  ROOT_ROLE_NAME,
  VIEWER_ROLE_NAME,
} from "../constants";
import { type SeedContext, type SeedStageResult } from "../stage-types";

const hasExactRoleIds = (current: string[], desired: string[]): boolean => {
  if (current.length !== desired.length) return false;
  const desiredSet = new Set(desired);
  return current.every((item) => desiredSet.has(item));
};

export async function runAssignDemoRoles(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  const roles = await ctx.repos.roleRepository.list();
  const rootRole = roles.find((role) => role.name === ROOT_ROLE_NAME);
  const editorRole = roles.find((role) => role.name === EDITOR_ROLE_NAME);
  const viewerRole = roles.find((role) => role.name === VIEWER_ROLE_NAME);

  if (!rootRole || !editorRole || !viewerRole) {
    throw new Error(
      "Missing Root, Editor, or Viewer role. Run role seeding stages first.",
    );
  }

  const allUsers = await ctx.repos.userRepository.list();
  const usersByEmail = new Map(allUsers.map((user) => [user.email, user]));
  const orderedUsers = DUMMY_USERS.map((dummy) =>
    usersByEmail.get(dummy.email),
  );

  const missingEmails = DUMMY_USERS.filter(
    (_dummy, index) => orderedUsers[index] == null,
  ).map((dummy) => dummy.email);

  if (missingEmails.length > 0 && ctx.args.strict) {
    throw new Error(
      `Missing dummy users required for strict mode: ${missingEmails.join(", ")}`,
    );
  }

  const rootEmail = DUMMY_USERS[0]?.email;
  if (!rootEmail) {
    return {
      name: "assign-demo-roles",
      created: 0,
      updated: 0,
      skipped: 0,
      notes: ["No dummy users configured"],
    };
  }

  let editorSlots = 5;
  let updated = 0;
  let skipped = 0;

  for (const user of orderedUsers) {
    if (!user) {
      skipped += 1;
      continue;
    }

    let desiredRoleId = viewerRole.id;
    if (user.email === rootEmail) {
      desiredRoleId = rootRole.id;
    } else if (editorSlots > 0) {
      desiredRoleId = editorRole.id;
      editorSlots -= 1;
    }

    const currentAssignments =
      await ctx.repos.userRoleRepository.listRolesByUserId(user.id);
    const currentRoleIds = currentAssignments.map(
      (assignment) => assignment.roleId,
    );
    const desiredRoleIds = [desiredRoleId];

    if (hasExactRoleIds(currentRoleIds, desiredRoleIds)) {
      skipped += 1;
      continue;
    }

    if (!ctx.args.dryRun) {
      await ctx.repos.userRoleRepository.setUserRoles(user.id, desiredRoleIds);
    }

    updated += 1;
  }

  const notes: string[] = [];
  if (missingEmails.length > 0) {
    notes.push(`Skipped missing users: ${missingEmails.join(", ")}`);
  }

  return {
    name: "assign-demo-roles",
    created: 0,
    updated,
    skipped,
    notes,
  };
}
