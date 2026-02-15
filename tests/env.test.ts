import { describe, expect, test } from "bun:test";
import { parseCorsOrigins } from "#/env";

describe("parseCorsOrigins", () => {
  test("trims whitespace and removes empty values", () => {
    expect(parseCorsOrigins("https://a.example, https://b.example, ,")).toEqual(
      ["https://a.example", "https://b.example"],
    );
  });

  test("returns a single origin as-is", () => {
    expect(parseCorsOrigins("http://localhost:3000")).toEqual([
      "http://localhost:3000",
    ]);
  });
});
