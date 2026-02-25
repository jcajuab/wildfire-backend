export type SeedMode = "full" | "baseline" | "root-only" | "permissions-only";

export interface SeedArgs {
  mode: SeedMode;
  email?: string;
  dryRun: boolean;
  strict: boolean;
  help?: boolean;
}

const VALID_MODES = new Set<SeedMode>([
  "full",
  "baseline",
  "root-only",
  "permissions-only",
]);

const parseFlagValue = (
  argv: string[],
  index: number,
  prefix: string,
): { value: string; consumed: number } => {
  const arg = argv[index];
  if (!arg) {
    throw new Error(`Missing ${prefix} value`);
  }

  if (arg === prefix) {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${prefix}`);
    }
    return { value, consumed: 2 };
  }

  if (arg.startsWith(`${prefix}=`)) {
    const value = arg.slice(prefix.length + 1).trim();
    if (!value) {
      throw new Error(`Missing value for ${prefix}`);
    }
    return { value, consumed: 1 };
  }

  throw new Error(`Unknown flag: ${arg}`);
};

const assertEmail = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("--email value must not be empty");
  }
  if (!normalized.includes("@")) {
    throw new Error(`Invalid --email value: ${value}`);
  }
  return normalized;
};

export function parseSeedArgs(argv: string[]): SeedArgs {
  if (argv.includes("--help") || argv.includes("-h")) {
    return {
      mode: "full",
      dryRun: false,
      strict: false,
      help: true,
    };
  }

  const parsed: SeedArgs = {
    mode: "full",
    dryRun: false,
    strict: false,
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

    if (arg === "--strict") {
      parsed.strict = true;
      i += 1;
      continue;
    }

    if (arg === "--mode" || arg.startsWith("--mode=")) {
      const { value, consumed } = parseFlagValue(argv, i, "--mode");
      if (!VALID_MODES.has(value as SeedMode)) {
        throw new Error(
          `Invalid --mode value: ${value}. Valid modes: full, baseline, root-only, permissions-only`,
        );
      }
      parsed.mode = value as SeedMode;
      i += consumed;
      continue;
    }

    if (arg === "--email" || arg.startsWith("--email=")) {
      const { value, consumed } = parseFlagValue(argv, i, "--email");
      parsed.email = assertEmail(value);
      i += consumed;
      continue;
    }

    throw new Error(`Unknown flag: ${arg}`);
  }

  return parsed;
}
