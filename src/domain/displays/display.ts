export class DisplayValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DisplayValidationError";
  }
}

export interface DisplayInput {
  name: string;
  identifier: string;
  displayFingerprint?: string | null;
  location?: string | null;
  ipAddress?: string | null;
  macAddress?: string | null;
  screenWidth?: number | null;
  screenHeight?: number | null;
  outputType?: string | null;
  orientation?: "LANDSCAPE" | "PORTRAIT" | null;
}

export interface DisplayProps {
  name: string;
  identifier: string;
  displayFingerprint: string | null;
  location: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  screenWidth: number | null;
  screenHeight: number | null;
  outputType: string | null;
  orientation: "LANDSCAPE" | "PORTRAIT" | null;
}

const normalize = (value: string) => value.trim();

export const createDisplayProps = (input: DisplayInput): DisplayProps => {
  const name = normalize(input.name);
  const identifier = normalize(input.identifier);

  if (!name) {
    throw new DisplayValidationError("Display name is required");
  }

  if (!identifier) {
    throw new DisplayValidationError("Display identifier is required");
  }

  return {
    name,
    identifier,
    displayFingerprint: input.displayFingerprint
      ? (() => {
          const trimmed = input.displayFingerprint.trim();
          return trimmed.length > 0 ? trimmed : null;
        })()
      : null,
    location: input.location ? input.location.trim() : null,
    ipAddress: input.ipAddress ? input.ipAddress.trim() : null,
    macAddress: input.macAddress ? input.macAddress.trim() : null,
    screenWidth: input.screenWidth ?? null,
    screenHeight: input.screenHeight ?? null,
    outputType: input.outputType ? input.outputType.trim() : null,
    orientation: input.orientation ?? null,
  };
};
