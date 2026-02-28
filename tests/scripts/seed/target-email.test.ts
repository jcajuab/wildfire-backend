import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_ROOT_EMAIL } from "../../../scripts/seed/constants";
import { resolveTargetEmail } from "../../../scripts/seed/target-email";

const originalSeedUserEmail = process.env.SEED_USER_EMAIL;

afterEach(() => {
  if (originalSeedUserEmail === undefined) {
    delete process.env.SEED_USER_EMAIL;
    return;
  }

  process.env.SEED_USER_EMAIL = originalSeedUserEmail;
});

describe("resolveTargetEmail", () => {
  test("returns explicit email when provided", () => {
    process.env.SEED_USER_EMAIL = "from-env@example.com";

    const result = resolveTargetEmail("explicit@example.com");

    expect(result).toBe("explicit@example.com");
  });

  test("does not fallback to SEED_USER_EMAIL env", () => {
    process.env.SEED_USER_EMAIL = "from-env@example.com";

    const result = resolveTargetEmail(undefined);

    expect(result).toBe(DEFAULT_ROOT_EMAIL);
  });
});
