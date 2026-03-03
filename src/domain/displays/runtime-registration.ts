import { type DisplayRegistrationState } from "#/application/ports/display-auth";

export interface RuntimeRegistrationCandidate {
  id: string;
  registrationState: DisplayRegistrationState | undefined;
  displayOutput: string | null | undefined;
}

export type RuntimeRegistrationDecision =
  | {
      kind: "create";
      fromState: "unpaired";
    }
  | {
      kind: "reactivate";
      displayId: string;
      fromState: "unregistered";
    }
  | {
      kind: "conflict";
      message: string;
    };

const isUnregistered = (
  state: DisplayRegistrationState | undefined,
): state is "unregistered" => state === "unregistered";

export const resolveRuntimeRegistrationDecision = (input: {
  existingBySlug: RuntimeRegistrationCandidate | null;
  existingByFingerprintAndOutput: RuntimeRegistrationCandidate | null;
  requestedOutput: string;
}): RuntimeRegistrationDecision => {
  const output = input.requestedOutput.trim().toLowerCase();
  const bySlug = input.existingBySlug;
  const byFingerprintAndOutput = input.existingByFingerprintAndOutput;

  if (bySlug) {
    const slugOutput = (bySlug.displayOutput ?? "").trim().toLowerCase();
    const outputMatches = slugOutput === output;
    if (!isUnregistered(bySlug.registrationState) || !outputMatches) {
      return {
        kind: "conflict",
        message: "Display slug already exists",
      };
    }
  }

  if (
    bySlug &&
    byFingerprintAndOutput &&
    bySlug.id !== byFingerprintAndOutput.id
  ) {
    return {
      kind: "conflict",
      message:
        "Display slug and fingerprint/output are assigned to different displays",
    };
  }

  const target = bySlug ?? byFingerprintAndOutput;
  if (!target) {
    return { kind: "create", fromState: "unpaired" };
  }
  if (!isUnregistered(target.registrationState)) {
    return {
      kind: "conflict",
      message: "Display fingerprint/output combination already exists",
    };
  }

  return {
    kind: "reactivate",
    displayId: target.id,
    fromState: "unregistered",
  };
};
