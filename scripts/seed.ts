import { parseSeedArgs } from "./seed/args";
import { consoleSeedReporter } from "./seed/reporter";
import { buildSeedStages, runSeedStages } from "./seed/runner";
import { resolveTargetEmail } from "./seed/target-email";

const usage = [
  "Usage: bun run db:seed -- [--mode=full|baseline|super-admin-only] [--email=user@example.com] [--dry-run] [--strict]",
  "",
  "Defaults:",
  "  --mode=full",
  "",
  "Modes:",
  "  full              Seed permissions, roles, demo users, assignments, and htshadow entries.",
  "  baseline          Seed permissions and Super Admin role; optional --email assignment.",
  "  super-admin-only  Seed only Super Admin role/wildcard permission; optional --email assignment.",
  "",
  "Flags:",
  "  --mode=<value>    Seed mode to run.",
  "  --email=<value>   Target user email for Super Admin assignment stage.",
  "  --dry-run         Show actions without writing DB/files.",
  "  --strict          Fail when expected data is missing instead of skipping.",
  "  --help, -h        Print this help and exit.",
  "",
  "Examples:",
  "  bun run db:seed",
  "  bun run db:seed -- --mode=baseline --email=admin@example.com",
  "  bun run db:seed -- --mode=super-admin-only --dry-run",
].join("\n");

let exitCode = 0;
let closeRuntime: (() => Promise<void>) | undefined;

try {
  const args = parseSeedArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage);
    process.exit(0);
  }

  const targetEmail = resolveTargetEmail(args.email);
  const { createSeedRuntimeContext } = await import("./seed/context");
  const runtime = createSeedRuntimeContext({ args, targetEmail });
  closeRuntime = runtime.close;

  const stages = buildSeedStages(args.mode);

  await runSeedStages({
    ctx: runtime.ctx,
    stages,
    reporter: consoleSeedReporter,
  });
} catch (error) {
  exitCode = 1;
  console.error(error);
  console.error(`\n${usage}`);
} finally {
  if (closeRuntime) {
    await closeRuntime();
  }
}

process.exit(exitCode);
