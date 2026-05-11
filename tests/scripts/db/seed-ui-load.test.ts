import { describe, expect, test } from "bun:test";
import {
  buildPlaylistDurations,
  buildPlaylistItemInput,
} from "../../../scripts/db/seed-ui-load";

describe("seed-ui-load playlist item payloads", () => {
  test("keeps the default five-item playlist under the sixty second limit", () => {
    const durations = buildPlaylistDurations(5);

    expect(durations).toEqual([8, 10, 12, 14, 16]);
    expect(
      durations.reduce((sum, duration) => sum + duration, 0),
    ).toBeLessThanOrEqual(60);
  });

  test("clamps video duration to the source content duration and loops videos", () => {
    const item = buildPlaylistItemInput(
      { id: "content-video", type: "VIDEO", duration: 2 },
      8,
    );

    expect(item).toEqual({
      contentId: "content-video",
      duration: 2,
      loop: true,
    });
  });

  test("keeps non-video duration and disables loop", () => {
    const item = buildPlaylistItemInput(
      { id: "content-text", type: "TEXT", duration: null },
      8,
    );

    expect(item).toEqual({
      contentId: "content-text",
      duration: 8,
      loop: false,
    });
  });

  test("keeps seeded playlist item duration positive", () => {
    const item = buildPlaylistItemInput(
      { id: "content-video", type: "VIDEO", duration: 0 },
      0,
    );

    expect(item.duration).toBe(1);
  });
});
