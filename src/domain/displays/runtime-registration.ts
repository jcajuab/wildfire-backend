export interface RuntimeRegistrationCandidate {
  id: string;
  output: string | null | undefined;
}

export type RuntimeRegistrationDecision =
  | {
      kind: "create";
    }
  | {
      kind: "conflict";
      message: string;
    };

export const resolveRuntimeRegistrationDecision = (input: {
  existingBySlug: RuntimeRegistrationCandidate | null;
  existingByFingerprintAndOutput: RuntimeRegistrationCandidate | null;
  requestedOutput: string;
}): RuntimeRegistrationDecision => {
  const bySlug = input.existingBySlug;
  const byFingerprintAndOutput = input.existingByFingerprintAndOutput;

  if (bySlug) {
    return {
      kind: "conflict",
      message: "Display slug already exists",
    };
  }

  const target = bySlug ?? byFingerprintAndOutput;
  if (!target) {
    return { kind: "create" };
  }
  return {
    kind: "conflict",
    message: "Display fingerprint/output combination already exists",
  };
};
