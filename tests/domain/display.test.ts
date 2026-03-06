import { describe, expect, test } from "bun:test";
import {
  createDisplayProps,
  DisplayValidationError,
} from "#/domain/displays/display";

describe("createDisplayProps", () => {
  test("returns normalized display props", () => {
    const props = createDisplayProps({
      name: " Lobby Display ",
      slug: "  AA:BB:CC ",
      location: "  Main Hall ",
    });

    expect(props).toEqual({
      name: "Lobby Display",
      slug: "AA:BB:CC",
      fingerprint: null,
      location: "Main Hall",
      ipAddress: null,
      macAddress: null,
      screenWidth: null,
      screenHeight: null,
      output: null,
      orientation: null,
    });
  });

  test("throws when name is empty", () => {
    expect(() => createDisplayProps({ name: "  ", slug: "abc" })).toThrow(
      DisplayValidationError,
    );
  });

  test("throws when slug is empty", () => {
    expect(() => createDisplayProps({ name: "Display", slug: "" })).toThrow(
      DisplayValidationError,
    );
  });

  test("normalizes optional fingerprint", () => {
    const props = createDisplayProps({
      name: "Display",
      slug: "abc",
      fingerprint: "  fp-123  ",
    });

    expect(props.fingerprint).toBe("fp-123");
  });
});
