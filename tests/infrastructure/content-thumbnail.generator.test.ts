import { describe, expect, test } from "bun:test";
import { DefaultContentThumbnailGenerator } from "#/infrastructure/media/content-thumbnail.generator";

describe("DefaultContentThumbnailGenerator", () => {
  test("generates thumbnail bytes for image input", async () => {
    const generator = new DefaultContentThumbnailGenerator({
      generateJpeg: async (input) => {
        expect(input.type).toBe("IMAGE");
        expect(input.maxWidth).toBe(400);
        expect(input.maxHeight).toBe(300);
        expect(input.seekSeconds).toBe(0);
        return new Uint8Array([1, 2, 3]);
      },
    });

    const result = await generator.generate({
      type: "IMAGE",
      mimeType: "image/png",
      data: new Uint8Array([255, 216, 255]),
    });

    expect(result).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("returns null when generation throws", async () => {
    const generator = new DefaultContentThumbnailGenerator({
      generateJpeg: async () => {
        throw new Error("ffmpeg unavailable");
      },
    });

    const result = await generator.generate({
      type: "VIDEO",
      mimeType: "video/mp4",
      data: new Uint8Array([0, 1, 2]),
    });

    expect(result).toBeNull();
  });
});
