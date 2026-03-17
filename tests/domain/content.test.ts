import { describe, expect, test } from "bun:test";
import {
  buildContentFileKey,
  buildContentThumbnailKey,
  parseContentStatus,
  parseContentType,
  resolveContentType,
  resolveFileExtension,
} from "#/domain/content/content";

describe("Content domain", () => {
  test("resolves content type from mime type", () => {
    expect(resolveContentType("image/png")).toBe("IMAGE");
    expect(resolveContentType("video/mp4")).toBe("VIDEO");
  });

  test("returns null for unsupported mime types", () => {
    expect(resolveContentType("application/zip")).toBeNull();
  });

  test("resolves file extensions", () => {
    expect(resolveFileExtension("image/jpeg")).toBe("jpg");
    expect(resolveFileExtension("video/mp4")).toBe("mp4");
  });

  test("parses content type values", () => {
    expect(parseContentType("IMAGE")).toBe("IMAGE");
    expect(parseContentType("VIDEO")).toBe("VIDEO");
    expect(parseContentType("PDF")).toBeNull();
    expect(parseContentType("OTHER")).toBeNull();
  });

  test("parses content status values", () => {
    expect(parseContentStatus("PROCESSING")).toBe("PROCESSING");
    expect(parseContentStatus("READY")).toBe("READY");
    expect(parseContentStatus("FAILED")).toBe("FAILED");
    expect(parseContentStatus("OTHER")).toBeNull();
  });

  test("builds content file key by type", () => {
    expect(
      buildContentFileKey({
        id: "content-1",
        type: "IMAGE",
        mimeType: "image/png",
      }),
    ).toBe("content/images/content-1.png");

    expect(
      buildContentFileKey({
        id: "content-2",
        type: "VIDEO",
        mimeType: "video/mp4",
      }),
    ).toBe("content/videos/content-2.mp4");
  });

  test("builds content thumbnail key", () => {
    expect(buildContentThumbnailKey("content-1")).toBe(
      "content/thumbnails/content-1.jpg",
    );
  });
});
