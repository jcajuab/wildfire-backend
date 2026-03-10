import { describe, expect, test } from "bun:test";
import {
  DISPLAY_DOWN_TIMEOUT_MS,
  deriveDisplayStatus,
} from "#/application/use-cases/displays/display-status";

describe("display status derivation", () => {
  test("returns PROCESSING when the display has never been seen", () => {
    const now = new Date("2026-03-10T00:00:00.000Z");

    expect(
      deriveDisplayStatus({
        lastSeenAt: null,
        hasActivePlayback: false,
        now,
      }),
    ).toBe("PROCESSING");
  });

  test("returns READY when recently seen without active playback", () => {
    const now = new Date("2026-03-10T00:05:00.000Z");

    expect(
      deriveDisplayStatus({
        lastSeenAt: new Date(
          now.getTime() - DISPLAY_DOWN_TIMEOUT_MS + 1_000,
        ).toISOString(),
        hasActivePlayback: false,
        now,
      }),
    ).toBe("READY");
  });

  test("returns LIVE when recently seen with active playback", () => {
    const now = new Date("2026-03-10T00:05:00.000Z");

    expect(
      deriveDisplayStatus({
        lastSeenAt: new Date(
          now.getTime() - DISPLAY_DOWN_TIMEOUT_MS + 1_000,
        ).toISOString(),
        hasActivePlayback: true,
        now,
      }),
    ).toBe("LIVE");
  });

  test("returns DOWN when the timeout window has elapsed", () => {
    const now = new Date("2026-03-10T00:05:00.000Z");

    expect(
      deriveDisplayStatus({
        lastSeenAt: new Date(
          now.getTime() - DISPLAY_DOWN_TIMEOUT_MS - 1_000,
        ).toISOString(),
        hasActivePlayback: true,
        now,
      }),
    ).toBe("DOWN");
  });
});
