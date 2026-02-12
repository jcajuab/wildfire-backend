import {
  BCRYPT_SALT_ROUNDS,
  DEFAULT_PASSWORD,
  DUMMY_USERS,
} from "../constants";
import { type SeedContext, type SeedStageResult } from "../stage-types";

export async function runSyncHtshadow(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  const passwordHash = await ctx.io.hashPassword(
    DEFAULT_PASSWORD,
    BCRYPT_SALT_ROUNDS,
  );
  const lines = DUMMY_USERS.map((user) => `${user.email}:${passwordHash}`);

  if (!ctx.args.dryRun) {
    await ctx.io.writeFile(ctx.htshadowPath, `${lines.join("\n")}\n`);
  }

  return {
    name: "sync-htshadow",
    created: lines.length,
    updated: 0,
    skipped: 0,
    notes: [
      `Password for all seeded users: ${DEFAULT_PASSWORD}`,
      ctx.args.dryRun
        ? "Dry-run skipped htshadow write"
        : `Wrote ${ctx.htshadowPath}`,
    ],
  };
}
