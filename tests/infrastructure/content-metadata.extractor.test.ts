import { describe, expect, mock, test } from "bun:test";

let configuredFfprobePath: string | null = null;

mock.module("fluent-ffmpeg", () => ({
  default: {
    setFfprobePath: (path: string) => {
      configuredFfprobePath = path;
    },
    ffprobe: () => undefined,
  },
}));

describe("DefaultContentMetadataExtractor", () => {
  test("configures fluent-ffmpeg with the runtime ffprobe path", async () => {
    const { DefaultContentMetadataExtractor } = await import(
      "#/infrastructure/media/content-metadata.extractor"
    );

    new DefaultContentMetadataExtractor({ ffprobePath: "/custom/ffprobe" });

    expect(configuredFfprobePath).toBe("/custom/ffprobe");
  });
});
