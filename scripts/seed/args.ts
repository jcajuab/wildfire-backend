export interface SeedArgs {
  dryRun: boolean;
  rootUsername?: string;
  rootEmail?: string;
  rootPassword?: string;
  help?: boolean;
}

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

const assertUsername = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("--root-username value must not be empty");
  }
  return normalized;
};

const assertEmail = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("--root-email value must not be empty");
  }
  if (!normalized.includes("@")) {
    throw new Error(`Invalid --root-email value: ${value}`);
  }
  return normalized;
};

const assertPassword = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("--root-password value must not be empty");
  }
  return normalized;
};

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

    if (arg === "--root-username" || arg.startsWith("--root-username=")) {
      const { value, consumed } = parseFlagValue(argv, i, "--root-username");
      parsed.rootUsername = assertUsername(value);
      i += consumed;
      continue;
    }

    if (arg === "--root-email" || arg.startsWith("--root-email=")) {
      const { value, consumed } = parseFlagValue(argv, i, "--root-email");
      parsed.rootEmail = assertEmail(value);
      i += consumed;
      continue;
    }

    if (arg === "--root-password" || arg.startsWith("--root-password=")) {
      const { value, consumed } = parseFlagValue(argv, i, "--root-password");
      parsed.rootPassword = assertPassword(value);
      i += consumed;
      continue;
    }

    throw new Error(`Unknown flag: ${arg}`);
  }

  return parsed;
}
