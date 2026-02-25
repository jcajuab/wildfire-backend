import { ROOT_ROLE_NAME } from "../constants";
import { type SeedContext, type SeedStageResult } from "../stage-types";

export async function runAssignRootEmail(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  const email = ctx.targetEmail;
  if (!email) {
    return {
      name: "assign-root-email",
      created: 0,
      updated: 0,
      skipped: 1,
      notes: ["No target email provided"],
    };
  }

  const user = await ctx.repos.userRepository.findByEmail(email);
  if (!user) {
    if (ctx.args.strict) {
      throw new Error(`Target user not found: ${email}`);
    }

    return {
      name: "assign-root-email",
      created: 0,
      updated: 0,
      skipped: 1,
      notes: [`Target user not found and skipped: ${email}`],
    };
  }

  const roles = await ctx.repos.roleRepository.list();
  const rootRole = roles.find((role) => role.name === ROOT_ROLE_NAME);
  if (!rootRole) {
    throw new Error(
      `Role ${ROOT_ROLE_NAME} not found. Run root seeding first.`,
    );
  }

  const assignments = await ctx.repos.userRoleRepository.listRolesByUserId(
    user.id,
  );
  const currentRoleIds = assignments.map((assignment) => assignment.roleId);
  const alreadyAssigned =
    currentRoleIds.length === 1 && currentRoleIds[0] === rootRole.id;

  if (alreadyAssigned) {
    return {
      name: "assign-root-email",
      created: 0,
      updated: 0,
      skipped: 1,
      notes: [`${email} already has only Root role`],
    };
  }

  if (!ctx.args.dryRun) {
    await ctx.repos.userRoleRepository.setUserRoles(user.id, [rootRole.id]);
  }

  return {
    name: "assign-root-email",
    created: 0,
    updated: 1,
    skipped: 0,
    notes: [
      ctx.args.dryRun
        ? `Dry-run: would assign Root to ${email}`
        : `Assigned Root to ${email}`,
    ],
  };
}
