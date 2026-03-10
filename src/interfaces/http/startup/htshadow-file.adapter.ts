import { readFile, rename, writeFile } from "node:fs/promises";

const normalizeUsername = (value: string): string => value.trim().toLowerCase();

/**
 * Parses htshadow file content into a username-to-hash map.
 * Format: "username:hash" per line.
 */
export const parseHtshadow = (input: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [rawUsername, rawHash] = trimmed.split(":", 2);
    const username = normalizeUsername(rawUsername ?? "");
    const hash = rawHash?.trim();
    if (!username || !hash) continue;
    out.set(username, hash);
  }
  return out;
};

/**
 * Reads htshadow file from disk and parses it into a map.
 * Returns empty map if file does not exist (ENOENT).
 */
export const readHtshadowMap = async (
  path: string,
): Promise<Map<string, string>> => {
  try {
    const raw = await readFile(path, "utf-8");
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

/**
 * Writes htshadow entries to disk atomically.
 * Entries are sorted by username for deterministic output.
 */
export const writeHtshadowMap = async (
  path: string,
  entries: ReadonlyMap<string, string>,
): Promise<void> => {
  const lines = [...entries.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([username, hash]) => `${username}:${hash}`);
  const output = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  const tmpPath = `${path}.tmp.${Date.now()}`;
  await writeFile(tmpPath, output, "utf-8");
  await rename(tmpPath, path);
};
