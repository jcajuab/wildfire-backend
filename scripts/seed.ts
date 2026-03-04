import { parseSeedArgs } from "./seed/args";
import { consoleSeedReporter } from "./seed/reporter";
import { resolveRootCredentials } from "./seed/root-credentials";
import { buildSeedStages, runSeedStages } from "./seed/runner";

const usage = [
  "Usage: bun run db:seed -- [--root-username=<username>] [--root-email=<email>] [--root-password=<password>] [--dry-run]",
  "",
  "Required:",
  "  Set root credentials from environment or CLI flags.",
  "",
  "Environment:",
  "  ROOT_USERNAME",
  "  ROOT_EMAIL (optional)",
  "  ROOT_PASSWORD",
  "",
  "Flags:",
  "  --root-username=<value>   Root account username.",
  "  --root-email=<value>      Root account email (optional).",
  "  --root-password=<value>   Password for the root account in htshadow.",
  "  --dry-run                Show actions without writing DB/files.",
  "  --help, -h               Print this help and exit.",
  "",
  "Examples:",
  "  bun run db:seed",
  "  bun run db:seed -- --root-username=admin --root-email=admin@example.com --root-password=supersecret",
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
    rootUsername: args.rootUsername,
    rootEmail: args.rootEmail,
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
