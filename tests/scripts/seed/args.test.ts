import { describe, expect, test } from "bun:test";
import { parseSeedArgs } from "../../../scripts/seed/args";

describe("parseSeedArgs", () => {
  test("uses defaults", () => {
    const parsed = parseSeedArgs([]);

    expect(parsed.dryRun).toBe(false);
    expect(parsed.rootUser).toBeUndefined();
    expect(parsed.rootPassword).toBeUndefined();
  });

  test("parses root user and password flags", () => {
    const parsed = parseSeedArgs([
      "--root-user=user@example.com",
      "--root-password=secret",
      "--dry-run",
    ]);

    expect(parsed).toEqual({
      dryRun: true,
      rootUser: "user@example.com",
      rootPassword: "secret",
    });
  });

  test("parses spaced root-user and root-password flags", () => {
    const parsed = parseSeedArgs([
      "--root-user",
      "admin@example.com",
      "--root-password",
      "supersecret",
    ]);

    expect(parsed.dryRun).toBe(false);
    expect(parsed.rootUser).toBe("admin@example.com");
    expect(parsed.rootPassword).toBe("supersecret");
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

  test("throws for invalid root user", () => {
    expect(() => parseSeedArgs(["--root-user=invalid"])).toThrow(
      "Invalid --root-user value",
    );
  });
});
