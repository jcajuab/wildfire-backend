import { describe, expect, test } from "bun:test";
import { splitPdfDocumentDurationAcrossPages } from "#/application/use-cases/shared/pdf-duration";

describe("splitPdfDocumentDurationAcrossPages", () => {
  test("distributes duration with front-loaded remainder", () => {
    expect(
      splitPdfDocumentDurationAcrossPages({
        totalDurationSeconds: 5,
        pageCount: 2,
      }),
    ).toEqual([3, 2]);
  });

  test("returns minimum one second per page when duration is shorter than page count", () => {
    expect(
      splitPdfDocumentDurationAcrossPages({
        totalDurationSeconds: 2,
        pageCount: 3,
      }),
    ).toEqual([1, 1, 1]);
  });
});
