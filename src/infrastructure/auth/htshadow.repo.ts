import { readFile, rename, writeFile } from "node:fs/promises";
import { type CredentialsRepository } from "#/application/ports/auth";

interface HtshadowCredentialsRepositoryDeps {
  filePath: string;
}

const normalizeUsername = (value: string): string => value.trim().toLowerCase();

export class HtshadowCredentialsRepository implements CredentialsRepository {
  private onBeforeWrite: (() => void) | null = null;

  constructor(private readonly deps: HtshadowCredentialsRepositoryDeps) {}

  setOnBeforeWrite(callback: () => void): void {
    this.onBeforeWrite = callback;
  }

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

  async updatePasswordHash(
    username: string,
    newPasswordHash: string,
  ): Promise<void> {
    const normalizedUsername = normalizeUsername(username);
    const data = await readFile(this.deps.filePath, "utf-8");
    const lines = data.split("\n");
    let found = false;
    const newLines = lines.map((line) => {
      const [lineUsername, hash] = line.split(":", 2);
      if (
        normalizeUsername(lineUsername ?? "") === normalizedUsername &&
        hash !== undefined
      ) {
        found = true;
        return `${normalizedUsername}:${newPasswordHash}`;
      }
      return line;
    });
    if (!found) {
      throw new Error(
        `User not found in credentials file: ${normalizedUsername}`,
      );
    }
    this.onBeforeWrite?.();
    const tmpPath = `${this.deps.filePath}.tmp.${Date.now()}`;
    await writeFile(tmpPath, newLines.join("\n"), "utf-8");
    await rename(tmpPath, this.deps.filePath);
  }

  async createPasswordHash(
    username: string,
    passwordHash: string,
  ): Promise<void> {
    const normalizedUsername = normalizeUsername(username);
    const data = await readFile(this.deps.filePath, "utf-8");
    const lines = data
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const hasEntry = lines.some(
      (line) =>
        normalizeUsername(line.split(":", 2)[0] ?? "") === normalizedUsername,
    );
    if (hasEntry) {
      throw new Error(
        `User already exists in credentials file: ${normalizedUsername}`,
      );
    }

    const next = [...lines, `${normalizedUsername}:${passwordHash}`];
    this.onBeforeWrite?.();
    const tmpPath = `${this.deps.filePath}.tmp.${Date.now()}`;
    await writeFile(tmpPath, `${next.join("\n")}\n`, "utf-8");
    await rename(tmpPath, this.deps.filePath);
  }
}
