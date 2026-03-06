import { describe, expect, test } from "bun:test";
import { resolveRuntimeRegistrationDecision } from "#/domain/displays/runtime-registration";

describe("resolveRuntimeRegistrationDecision", () => {
  test("returns create when no conflicting display exists", () => {
    const decision = resolveRuntimeRegistrationDecision({
      existingBySlug: null,
      existingByFingerprintAndOutput: null,
      requestedOutput: "HDMI-0",
    });

    expect(decision).toEqual({
      kind: "create",
    });
  });

  test("returns conflict when slug already exists", () => {
    const decision = resolveRuntimeRegistrationDecision({
      existingBySlug: {
        id: "display-1",
        output: "HDMI-0",
      },
      existingByFingerprintAndOutput: null,
      requestedOutput: "HDMI-0",
    });

    expect(decision).toEqual({
      kind: "conflict",
      message: "Display slug already exists",
    });
  });

  test("returns conflict when slug exists even if output casing differs", () => {
    const decision = resolveRuntimeRegistrationDecision({
      existingBySlug: {
        id: "display-1",
        output: "hdmi-0",
      },
      existingByFingerprintAndOutput: null,
      requestedOutput: "HDMI-0",
    });

    expect(decision).toEqual({
      kind: "conflict",
      message: "Display slug already exists",
    });
  });

  test("returns conflict when fingerprint/output already exists", () => {
    const decision = resolveRuntimeRegistrationDecision({
      existingBySlug: null,
      existingByFingerprintAndOutput: {
        id: "display-2",
        output: "HDMI-1",
      },
      requestedOutput: "HDMI-1",
    });

    expect(decision).toEqual({
      kind: "conflict",
      message: "Display fingerprint/output combination already exists",
    });
  });

  test("returns conflict when slug and fingerprint/output point to different displays", () => {
    const decision = resolveRuntimeRegistrationDecision({
      existingBySlug: {
        id: "display-1",
        output: "HDMI-0",
      },
      existingByFingerprintAndOutput: {
        id: "display-2",
        output: "HDMI-0",
      },
      requestedOutput: "HDMI-0",
    });

    expect(decision).toEqual({
      kind: "conflict",
      message: "Display slug already exists",
    });
  });
});
