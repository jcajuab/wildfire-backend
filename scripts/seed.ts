import { parseSeedArgs } from "./seed/args";
import { consoleSeedReporter } from "./seed/reporter";
import { resolveRootCredentials } from "./seed/root-credentials";
import { buildSeedStages, runSeedStages } from "./seed/runner";

const usage = [
  "Usage: bun run db:seed -- [--root-user=user@example.com] [--root-password=<password>] [--dry-run]",
  "",
  "Required:",
  "  Set root credentials from environment or CLI flags.",
  "",
  "Environment:",
  "  ROOT_USER",
  "  ROOT_PASSWORD",
  "",
  "Flags:",
  "  --root-user=<value>      Root account email.",
  "  --root-password=<value>   Password for the root account in htshadow.",
  "  --dry-run                Show actions without writing DB/files.",
  "  --help, -h               Print this help and exit.",
  "",
  "Examples:",
  "  bun run db:seed",
  "  bun run db:seed -- --root-user=admin@example.com --root-password=supersecret",
  "  bun run db:seed -- --dry-run",
].join("\n");

let exitCode = 0;
let closeRuntime: (() => Promise<void>) | undefined;

try {
  const args = parseSeedArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage);
    process.exit(0);
  }

  const root = resolveRootCredentials({
    rootUser: args.rootUser,
    rootPassword: args.rootPassword,
  });
  const { createSeedRuntimeContext } = await import("./seed/context");
  const runtime = createSeedRuntimeContext({ args, root });
  closeRuntime = runtime.close;

  const stages = buildSeedStages();

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
