const normalizeUsername = (value: string): string => value.trim().toLowerCase();

export const parseHtshadow = (input: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const [rawUsername, rawHash] = trimmed.split(":", 2);
    const username = normalizeUsername(rawUsername ?? "");
    const hash = rawHash?.trim();
    if (!username || !hash) {
      continue;
    }
    out.set(username, hash);
  }
  return out;
};

export const readHtshadowMap = async (input: {
  path: string;
  readFile(path: string): Promise<string>;
}): Promise<Map<string, string>> => {
  try {
    const raw = await input.readFile(input.path);
    return parseHtshadow(raw);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return new Map<string, string>();
    }
    throw error;
  }
};

export const serializeHtshadow = (
  entries: ReadonlyMap<string, string>,
): string => {
  const lines = [...entries.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([username, hash]) => `${username}:${hash}`);
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
};

export const normalizeHtshadowUsername = normalizeUsername;
