import { describe, expect, test } from "bun:test";
import { DefaultContentThumbnailGenerator } from "#/infrastructure/media/content-thumbnail.generator";

describe("DefaultContentThumbnailGenerator", () => {
  test("generates thumbnail bytes for image input", async () => {
    let pdfStrategyCalled = false;
    const generator = new DefaultContentThumbnailGenerator({
      generateJpeg: async (input) => {
        expect(input.type).toBe("IMAGE");
        expect(input.maxWidth).toBe(400);
        expect(input.maxHeight).toBe(300);
        expect(input.seekSeconds).toBe(0);
        return new Uint8Array([1, 2, 3]);
      },
      generatePdf: async () => {
        pdfStrategyCalled = true;
        return null;
      },
    });

    const result = await generator.generate({
      type: "IMAGE",
      mimeType: "image/png",
      data: new Uint8Array([255, 216, 255]),
    });

    expect(result).toEqual(new Uint8Array([1, 2, 3]));
    expect(pdfStrategyCalled).toBeFalse();
  });

  test("generates thumbnail bytes for pdf input", async () => {
    let jpegStrategyCalled = false;
    const generator = new DefaultContentThumbnailGenerator({
      generateJpeg: async () => {
        jpegStrategyCalled = true;
        return null;
      },
      generatePdf: async (input) => {
        expect(input.type).toBe("PDF");
        expect(input.maxWidth).toBe(400);
        expect(input.maxHeight).toBe(300);
        expect(input.mimeType).toBe("application/pdf");
        return new Uint8Array([9, 9, 9]);
      },
    });

    const result = await generator.generate({
      type: "PDF",
      mimeType: "application/pdf",
      data: new Uint8Array([37, 80, 68, 70]),
    });

    expect(result).toEqual(new Uint8Array([9, 9, 9]));
    expect(jpegStrategyCalled).toBeFalse();
  });

  test("returns null when generation throws", async () => {
    const generator = new DefaultContentThumbnailGenerator({
      generateJpeg: async () => {
        throw new Error("ffmpeg unavailable");
      },
      generatePdf: async () => new Uint8Array([1]),
    });

    const result = await generator.generate({
      type: "VIDEO",
      mimeType: "video/mp4",
      data: new Uint8Array([0, 1, 2]),
    });

    expect(result).toBeNull();
  });

  test("returns null when pdf generation throws", async () => {
    const generator = new DefaultContentThumbnailGenerator({
      generateJpeg: async () => new Uint8Array([1]),
      generatePdf: async () => {
        throw new Error("pdftoppm unavailable");
      },
    });

    const result = await generator.generate({
      type: "PDF",
      mimeType: "application/pdf",
      data: new Uint8Array([37, 80, 68, 70]),
    });

    expect(result).toBeNull();
  });
});
