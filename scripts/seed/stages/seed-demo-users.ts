import { DUMMY_USERS } from "../constants";
import { type SeedContext, type SeedStageResult } from "../stage-types";

export async function runSeedDemoUsers(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  let created = 0;
  let skipped = 0;

  for (const user of DUMMY_USERS) {
    const existing = await ctx.repos.userRepository.findByEmail(user.email);
    if (existing) {
      skipped += 1;
      continue;
    }

    if (!ctx.args.dryRun) {
      await ctx.repos.userRepository.create({
        email: user.email,
        name: user.name,
        isActive: true,
      });
    }

    created += 1;
  }

  return {
    name: "seed-demo-users",
    created,
    updated: 0,
    skipped,
  };
}
