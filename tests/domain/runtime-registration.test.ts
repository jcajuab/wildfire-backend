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
      fromState: "unpaired",
    });
  });

  test("reactivates unregistered display found by slug", () => {
    const decision = resolveRuntimeRegistrationDecision({
      existingBySlug: {
        id: "display-1",
        registrationState: "unregistered",
        displayOutput: "HDMI-0",
      },
      existingByFingerprintAndOutput: null,
      requestedOutput: "HDMI-0",
    });

    expect(decision).toEqual({
      kind: "reactivate",
      displayId: "display-1",
      fromState: "unregistered",
    });
  });

  test("reactivates slug match when output differs only by case", () => {
    const decision = resolveRuntimeRegistrationDecision({
      existingBySlug: {
        id: "display-1",
        registrationState: "unregistered",
        displayOutput: "hdmi-0",
      },
      existingByFingerprintAndOutput: null,
      requestedOutput: "HDMI-0",
    });

    expect(decision).toEqual({
      kind: "reactivate",
      displayId: "display-1",
      fromState: "unregistered",
    });
  });

  test("falls back to fingerprint/output reactivation when slug is unused", () => {
    const decision = resolveRuntimeRegistrationDecision({
      existingBySlug: null,
      existingByFingerprintAndOutput: {
        id: "display-2",
        registrationState: "unregistered",
        displayOutput: "HDMI-1",
      },
      requestedOutput: "HDMI-1",
    });

    expect(decision).toEqual({
      kind: "reactivate",
      displayId: "display-2",
      fromState: "unregistered",
    });
  });

  test("returns conflict when slug exists in active lifecycle", () => {
    const decision = resolveRuntimeRegistrationDecision({
      existingBySlug: {
        id: "display-1",
        registrationState: "registered",
        displayOutput: "HDMI-0",
      },
      existingByFingerprintAndOutput: null,
      requestedOutput: "HDMI-0",
    });

    expect(decision).toEqual({
      kind: "conflict",
      message: "Display slug already exists",
    });
  });

  test("returns conflict when slug and fingerprint/output point to different displays", () => {
    const decision = resolveRuntimeRegistrationDecision({
      existingBySlug: {
        id: "display-1",
        registrationState: "unregistered",
        displayOutput: "HDMI-0",
      },
      existingByFingerprintAndOutput: {
        id: "display-2",
        registrationState: "unregistered",
        displayOutput: "HDMI-0",
      },
      requestedOutput: "HDMI-0",
    });

    expect(decision).toEqual({
      kind: "conflict",
      message:
        "Display slug and fingerprint/output are assigned to different displays",
    });
  });
});
