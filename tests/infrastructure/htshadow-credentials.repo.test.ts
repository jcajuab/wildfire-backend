import { describe, expect, test } from "bun:test";
import path from "node:path";
import { HtshadowCredentialsRepository } from "#/infrastructure/auth/htshadow.repo";

const fixturePath = path.join(import.meta.dir, "../fixtures/example_htshadow");

describe("HtshadowCredentialsRepository", () => {
  test("returns hash for existing user", async () => {
    const repo = new HtshadowCredentialsRepository({ filePath: fixturePath });
    const hash = await repo.findPasswordHash("test1");

    expect(hash).toBe(
      "$2y$05$/DOLvW/Ik.IObiHeAhCaEeHEbfZBozBvHihclOISfRAG4kKu4MuFe",
    );
  });

  test("returns null when user is missing", async () => {
    const repo = new HtshadowCredentialsRepository({ filePath: fixturePath });
    const hash = await repo.findPasswordHash("missing-user");

    expect(hash).toBeNull();
  });
});
