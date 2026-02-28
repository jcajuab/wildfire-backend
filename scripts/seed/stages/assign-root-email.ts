import { ROOT_ROLE_NAME } from "../constants";
import { type SeedContext, type SeedStageResult } from "../stage-types";

export async function runAssignRootEmail(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  const email = ctx.targetEmail;

  const user = await ctx.repos.userRepository.findByEmail(email);
  if (!user) {
    throw new Error(`Target user not found: ${email}`);
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
  const hasRootRole = currentRoleIds.includes(rootRole.id);
  const roleIdsToAssign = hasRootRole
    ? currentRoleIds
    : [...new Set([rootRole.id, ...currentRoleIds])];

  if (hasRootRole) {
    return {
      name: "assign-root-email",
      created: 0,
      updated: 0,
      skipped: 1,
      notes: [
        ctx.args.dryRun
          ? `Dry-run: ${email} already has Root role`
          : currentRoleIds.length > 0
            ? `${email} already has Root role and existing roles were preserved`
            : `${email} already has Root role`,
      ],
    };
  }

  if (!ctx.args.dryRun) {
    await ctx.repos.userRoleRepository.setUserRoles(user.id, roleIdsToAssign);
  }

  return {
    name: "assign-root-email",
    created: 0,
    updated: 1,
    skipped: 0,
    notes: [
      ctx.args.dryRun
        ? `Dry-run: would assign Root to ${email}`
        : `Assigned Root to ${email} while preserving existing roles`,
    ],
  };
}
