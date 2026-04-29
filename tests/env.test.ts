import { describe, expect, test } from "bun:test";
import { env, parseCorsOrigins } from "#/env";

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

describe("env", () => {
  test("defaults FFPROBE_PATH to the system binary path", () => {
    expect(env.FFPROBE_PATH).toBe("/usr/bin/ffprobe");
  });
});
