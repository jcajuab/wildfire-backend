import { asSeedRunId } from "#/infrastructure/observability/startup-logging";
import { parseSeedArgs } from "./seed/args";
import { consoleSeedReporter } from "./seed/reporter";
import { buildSeedCleanupStages, runSeedStages } from "./seed/runner";

const usage = [
  "Usage: bun run db:seed:cleanup -- [--dry-run]",
  "",
  "Purpose:",
  "  Remove demo seed data for local development only.",
  "  Startup remains responsible for root identity and canonical permission sync.",
  "",
  "Flags:",
  "  --dry-run                Show actions without writing DB/files.",
  "  --help, -h               Print this help and exit.",
  "",
  "Examples:",
  "  bun run db:seed:cleanup",
  "  bun run db:seed:cleanup -- --dry-run",
].join("\n");

let exitCode = 0;
let closeRuntime: (() => Promise<void>) | undefined;

try {
  const args = parseSeedArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage);
    process.exit(0);
  }

  const { createSeedRuntimeContext } = await import("./seed/context");
  const runtime = createSeedRuntimeContext({ args });
  closeRuntime = runtime.close;
  const runId = asSeedRunId();

  const stages = buildSeedCleanupStages();

  await runSeedStages({
    ctx: runtime.ctx,
    stages,
    reporter: consoleSeedReporter,
    runId,
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
