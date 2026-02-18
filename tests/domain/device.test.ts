import { describe, expect, test } from "bun:test";
import {
  createDeviceProps,
  DeviceValidationError,
} from "#/domain/devices/device";

describe("createDeviceProps", () => {
  test("returns normalized device props", () => {
    const props = createDeviceProps({
      name: " Lobby Display ",
      identifier: "  AA:BB:CC ",
      location: "  Main Hall ",
    });

    expect(props).toEqual({
      name: "Lobby Display",
      identifier: "AA:BB:CC",
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
    expect(() => createDeviceProps({ name: "  ", identifier: "abc" })).toThrow(
      DeviceValidationError,
    );
  });

  test("throws when identifier is empty", () => {
    expect(() =>
      createDeviceProps({ name: "Display", identifier: "" }),
    ).toThrow(DeviceValidationError);
  });
});
