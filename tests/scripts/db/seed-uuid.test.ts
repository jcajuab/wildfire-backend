import { describe, expect, test } from "bun:test";
import { deterministicUuid, isSeedUuid } from "../../../scripts/db/seed-uuid";

describe("deterministicUuid", () => {
  test("generates stable UUIDs accepted by API route validators", () => {
    const seeds = [
      "ui-load:display:1",
      "ui-load:text-content:1",
      "ui-load:image-content:1",
      "ui-load:video-content:1",
      "ui-load:flash-content:1",
      "ui-load:playlist:1",
      "ui-load:playlist-item:1:1",
      "ui-load:schedule:1",
    ];

    for (const seed of seeds) {
      const id = deterministicUuid(seed);

      expect(isSeedUuid(id)).toBe(true);
      expect(id.charAt(14)).toBe("5");
      expect(["8", "9", "a", "b"]).toContain(id.charAt(19));
    }
  });

  test("returns the same UUID for the same seed and different UUIDs for different seeds", () => {
    expect(deterministicUuid("ui-load:playlist:1")).toBe(
      deterministicUuid("ui-load:playlist:1"),
    );
    expect(deterministicUuid("ui-load:playlist:1")).not.toBe(
      deterministicUuid("ui-load:playlist:2"),
    );
  });
});
