import { readFile, rename, writeFile } from "node:fs/promises";
import { type CredentialsRepository } from "#/application/ports/auth";

interface HtshadowCredentialsRepositoryDeps {
  filePath: string;
}

export class HtshadowCredentialsRepository implements CredentialsRepository {
  constructor(private readonly deps: HtshadowCredentialsRepositoryDeps) {}

  async findPasswordHash(username: string): Promise<string | null> {
    const data = await readFile(this.deps.filePath, "utf-8");
    const lines = data.split("\n").map((line) => line.trim());

    for (const line of lines) {
      if (!line) continue;
      const [lineUsername, hash] = line.split(":", 2);
      if (lineUsername === username && hash) {
        return hash.trim();
      }
    }

    return null;
  }

  async updatePasswordHash(
    email: string,
    newPasswordHash: string,
  ): Promise<void> {
    const data = await readFile(this.deps.filePath, "utf-8");
    const lines = data.split("\n");
    let found = false;
    const newLines = lines.map((line) => {
      const [lineUsername, hash] = line.split(":", 2);
      if (lineUsername?.trim() === email && hash !== undefined) {
        found = true;
        return `${email}:${newPasswordHash}`;
      }
      return line;
    });
    if (!found) {
      throw new Error(`User not found in credentials file: ${email}`);
    }
    const tmpPath = `${this.deps.filePath}.tmp.${Date.now()}`;
    await writeFile(tmpPath, newLines.join("\n"), "utf-8");
    await rename(tmpPath, this.deps.filePath);
  }

  async createPasswordHash(email: string, passwordHash: string): Promise<void> {
    const data = await readFile(this.deps.filePath, "utf-8");
    const lines = data
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const hasEntry = lines.some(
      (line) => line.split(":", 2)[0]?.trim() === email,
    );
    if (hasEntry) {
      throw new Error(`User already exists in credentials file: ${email}`);
    }

    const next = [...lines, `${email}:${passwordHash}`];
    const tmpPath = `${this.deps.filePath}.tmp.${Date.now()}`;
    await writeFile(tmpPath, `${next.join("\n")}\n`, "utf-8");
    await rename(tmpPath, this.deps.filePath);
  }
}
