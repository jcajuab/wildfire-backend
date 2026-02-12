import { SUPER_ADMIN_ROLE_NAME } from "../constants";
import { type SeedContext, type SeedStageResult } from "../stage-types";

export async function runAssignSuperAdminEmail(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  const email = ctx.targetEmail;
  if (!email) {
    return {
      name: "assign-super-admin-email",
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
      name: "assign-super-admin-email",
      created: 0,
      updated: 0,
      skipped: 1,
      notes: [`Target user not found and skipped: ${email}`],
    };
  }

  const roles = await ctx.repos.roleRepository.list();
  const superAdminRole = roles.find(
    (role) => role.name === SUPER_ADMIN_ROLE_NAME,
  );
  if (!superAdminRole) {
    throw new Error(
      `Role ${SUPER_ADMIN_ROLE_NAME} not found. Run super-admin seeding first.`,
    );
  }

  const assignments = await ctx.repos.userRoleRepository.listRolesByUserId(
    user.id,
  );
  const currentRoleIds = assignments.map((assignment) => assignment.roleId);
  const alreadyAssigned =
    currentRoleIds.length === 1 && currentRoleIds[0] === superAdminRole.id;

  if (alreadyAssigned) {
    return {
      name: "assign-super-admin-email",
      created: 0,
      updated: 0,
      skipped: 1,
      notes: [`${email} already has only Super Admin role`],
    };
  }

  if (!ctx.args.dryRun) {
    await ctx.repos.userRoleRepository.setUserRoles(user.id, [
      superAdminRole.id,
    ]);
  }

  return {
    name: "assign-super-admin-email",
    created: 0,
    updated: 1,
    skipped: 0,
    notes: [
      ctx.args.dryRun
        ? `Dry-run: would assign Super Admin to ${email}`
        : `Assigned Super Admin to ${email}`,
    ],
  };
}
