import { describe, expect, test } from "bun:test";
import { parseSeedArgs } from "../../../scripts/seed/args";

describe("parseSeedArgs", () => {
  test("uses defaults", () => {
    const parsed = parseSeedArgs([]);

    expect(parsed.dryRun).toBe(false);
    expect(parsed.rootUsername).toBeUndefined();
    expect(parsed.rootEmail).toBeUndefined();
    expect(parsed.rootPassword).toBeUndefined();
  });

  test("parses root username, email, and password flags", () => {
    const parsed = parseSeedArgs([
      "--root-username=admin",
      "--root-email=admin@example.com",
      "--root-password=secret",
      "--dry-run",
    ]);

    expect(parsed).toEqual({
      dryRun: true,
      rootUsername: "admin",
      rootEmail: "admin@example.com",
      rootPassword: "secret",
    });
  });

  test("parses spaced root-username and root-password flags", () => {
    const parsed = parseSeedArgs([
      "--root-username",
      "admin",
      "--root-password",
      "supersecret",
    ]);

    expect(parsed.dryRun).toBe(false);
    expect(parsed.rootUsername).toBe("admin");
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

  test("throws for invalid root email", () => {
    expect(() => parseSeedArgs(["--root-email=invalid"])).toThrow(
      "Invalid --root-email value",
    );
  });
});
