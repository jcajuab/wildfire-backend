export interface SeedArgs {
  dryRun: boolean;
  help?: boolean;
}

export function parseSeedArgs(argv: string[]): SeedArgs {
  if (argv.includes("--help") || argv.includes("-h")) {
    return {
      dryRun: false,
      help: true,
    };
  }

  const parsed: SeedArgs = {
    dryRun: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (!arg) {
      i += 1;
      continue;
    }

    if (arg === "--dry-run") {
      parsed.dryRun = true;
      i += 1;
      continue;
    }

    throw new Error(`Unknown flag: ${arg}`);
  }

  return parsed;
}
