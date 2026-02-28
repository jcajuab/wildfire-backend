import { describe, expect, test } from "bun:test";
import {
  createDisplayProps,
  DisplayValidationError,
} from "#/domain/displays/display";

describe("createDisplayProps", () => {
  test("returns normalized display props", () => {
    const props = createDisplayProps({
      name: " Lobby Display ",
      identifier: "  AA:BB:CC ",
      location: "  Main Hall ",
    });

    expect(props).toEqual({
      name: "Lobby Display",
      identifier: "AA:BB:CC",
      displayFingerprint: null,
      location: "Main Hall",
      ipAddress: null,
      macAddress: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
    });
  });

  test("throws when name is empty", () => {
    expect(() => createDisplayProps({ name: "  ", identifier: "abc" })).toThrow(
      DisplayValidationError,
    );
  });

  test("throws when identifier is empty", () => {
    expect(() =>
      createDisplayProps({ name: "Display", identifier: "" }),
    ).toThrow(DisplayValidationError);
  });

  test("normalizes optional fingerprint", () => {
    const props = createDisplayProps({
      name: "Display",
      identifier: "abc",
      displayFingerprint: "  fp-123  ",
    });

    expect(props.displayFingerprint).toBe("fp-123");
  });
});
