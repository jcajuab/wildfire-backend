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
    expect(resolveContentType("application/pdf")).toBe("PDF");
  });

  test("returns null for unsupported mime types", () => {
    expect(resolveContentType("application/zip")).toBeNull();
  });

  test("resolves file extensions", () => {
    expect(resolveFileExtension("image/jpeg")).toBe("jpg");
    expect(resolveFileExtension("video/mp4")).toBe("mp4");
    expect(resolveFileExtension("application/pdf")).toBe("pdf");
  });

  test("parses content type values", () => {
    expect(parseContentType("IMAGE")).toBe("IMAGE");
    expect(parseContentType("VIDEO")).toBe("VIDEO");
    expect(parseContentType("PDF")).toBe("PDF");
    expect(parseContentType("OTHER")).toBeNull();
  });

  test("parses content status values", () => {
    expect(parseContentStatus("DRAFT")).toBe("DRAFT");
    expect(parseContentStatus("IN_USE")).toBe("IN_USE");
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

    expect(
      buildContentFileKey({
        id: "content-3",
        type: "PDF",
        mimeType: "application/pdf",
      }),
    ).toBe("content/documents/content-3.pdf");
  });

  test("builds content thumbnail key", () => {
    expect(buildContentThumbnailKey("content-1")).toBe(
      "content/thumbnails/content-1.jpg",
    );
  });
});
