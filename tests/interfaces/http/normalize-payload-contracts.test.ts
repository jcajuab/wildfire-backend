import { describe, expect, test } from "bun:test";
import { normalizeApiPayload } from "#/interfaces/http/responses";

describe("normalizeApiPayload", () => {
  test("wraps object payloads in data envelope", () => {
    const normalized = normalizeApiPayload(
      {
        playlistId: null,
      },
      { requestUrl: "http://localhost/api/v1/display-runtime/lobby/manifest" },
    ) as { data: unknown };

    expect(typeof normalized).toBe("object");
    expect(normalized).toHaveProperty("data");
  });

  test("rejects list payloads missing meta", () => {
    expect(() =>
      normalizeApiPayload(
        {
          data: [],
        },
        { requestUrl: "http://localhost/api/v1/displays" },
      ),
    ).toThrow("missing meta envelope");
  });
});
