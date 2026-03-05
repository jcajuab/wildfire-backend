import { describe, expect, test } from "bun:test";
import { parseSeedArgs } from "../../../scripts/seed/args";

describe("parseSeedArgs", () => {
  test("uses defaults", () => {
    const parsed = parseSeedArgs([]);

    expect(parsed.dryRun).toBe(false);
  });

  test("parses dry-run flag", () => {
    const parsed = parseSeedArgs(["--dry-run"]);
    expect(parsed.dryRun).toBe(true);
  });

  test("supports --help flag", () => {
    const parsed = parseSeedArgs(["--help"]);
    expect(parsed.help).toBe(true);
  });

  test("supports -h flag", () => {
    const parsed = parseSeedArgs(["-h"]);
    expect(parsed.help).toBe(true);
  });

  test("throws for unknown flags", () => {
    expect(() => parseSeedArgs(["--oops"])).toThrow("Unknown flag: --oops");
  });
});
