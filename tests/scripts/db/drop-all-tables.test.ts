import { describe, expect, test } from "bun:test";
import { parseDropArgs } from "../../../scripts/db/drop-all-tables";

describe("parseDropArgs", () => {
  test("requires explicit force flag", () => {
    const parsed = parseDropArgs([]);
    expect(parsed.force).toBe(false);

    const forced = parseDropArgs(["--force"]);
    expect(forced.force).toBe(true);
  });

  test("throws on unknown flags", () => {
    expect(() => parseDropArgs(["--force", "--oops"])).toThrow(
      "Unknown flag(s): --oops",
    );
  });
});
