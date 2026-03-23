import { readFile } from "node:fs/promises";
import { type CredentialsReader } from "#/application/ports/auth";
import { normalizeUsername } from "#/shared/string-utils";

interface HtshadowCredentialsRepositoryDeps {
  filePath: string;
}

/**
 * Read-only credentials repository for the htshadow file.
 * Wildfire must not write to htshadow; DCISM users are managed externally.
 */
export class HtshadowCredentialsRepository implements CredentialsReader {
  constructor(private readonly deps: HtshadowCredentialsRepositoryDeps) {}

  async findPasswordHash(username: string): Promise<string | null> {
    const normalizedUsername = normalizeUsername(username);
    const data = await readFile(this.deps.filePath, "utf-8");
    const lines = data.split("\n").map((line) => line.trim());

    for (const line of lines) {
      if (!line) continue;
      const [lineUsername, hash] = line.split(":", 2);
      if (
        normalizeUsername(lineUsername ?? "") === normalizedUsername &&
        hash
      ) {
        return hash.trim();
      }
    }

    return null;
  }
}
