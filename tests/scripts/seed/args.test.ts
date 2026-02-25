import { describe, expect, test } from "bun:test";
import { parseSeedArgs } from "../../../scripts/seed/args";

describe("parseSeedArgs", () => {
  test("uses full mode by default", () => {
    const parsed = parseSeedArgs([]);

    expect(parsed.mode).toBe("full");
    expect(parsed.dryRun).toBe(false);
    expect(parsed.strict).toBe(false);
    expect(parsed.email).toBeUndefined();
  });

  test("parses explicit flags", () => {
    const parsed = parseSeedArgs([
      "--mode=baseline",
      "--email=user@example.com",
      "--dry-run",
      "--strict",
    ]);

    expect(parsed).toEqual({
      mode: "baseline",
      email: "user@example.com",
      dryRun: true,
      strict: true,
    });
  });

  test("parses spaced mode and email flags", () => {
    const parsed = parseSeedArgs(["--mode", "root-only", "--email", "a@b.com"]);

    expect(parsed.mode).toBe("root-only");
    expect(parsed.email).toBe("a@b.com");
  });

  test("supports --help flag", () => {
    const parsed = parseSeedArgs(["--help"]);

    expect(parsed.help).toBe(true);
  });

  test("supports -h short flag", () => {
    const parsed = parseSeedArgs(["-h"]);

    expect(parsed.help).toBe(true);
  });

  test("throws for unknown flags", () => {
    expect(() => parseSeedArgs(["--oops"])).toThrow("Unknown flag: --oops");
  });

  test("throws for invalid mode", () => {
    expect(() => parseSeedArgs(["--mode=bad"])).toThrow(
      "Invalid --mode value: bad",
    );
  });
});
