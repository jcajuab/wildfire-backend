export class DisplayValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DisplayValidationError";
  }
}

export interface DisplayInput {
  name: string;
  slug: string;
  fingerprint?: string | null;
  location?: string | null;
  ipAddress?: string | null;
  macAddress?: string | null;
  screenWidth?: number | null;
  screenHeight?: number | null;
  output?: string | null;
  orientation?: "LANDSCAPE" | "PORTRAIT" | null;
}

export interface DisplayProps {
  name: string;
  slug: string;
  fingerprint: string | null;
  location: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  screenWidth: number | null;
  screenHeight: number | null;
  output: string | null;
  orientation: "LANDSCAPE" | "PORTRAIT" | null;
}

const normalize = (value: string) => value.trim();

export const createDisplayProps = (input: DisplayInput): DisplayProps => {
  const name = normalize(input.name);
  const slug = normalize(input.slug);

  if (!name) {
    throw new DisplayValidationError("Display name is required");
  }

  if (!slug) {
    throw new DisplayValidationError("Display slug is required");
  }

  return {
    name,
    slug,
    fingerprint: input.fingerprint
      ? (() => {
          const trimmed = input.fingerprint.trim();
          return trimmed.length > 0 ? trimmed : null;
        })()
      : null,
    location: input.location ? input.location.trim() : null,
    ipAddress: input.ipAddress ? input.ipAddress.trim() : null,
    macAddress: input.macAddress ? input.macAddress.trim() : null,
    screenWidth: input.screenWidth ?? null,
    screenHeight: input.screenHeight ?? null,
    output: input.output ? input.output.trim() : null,
    orientation: input.orientation ?? null,
  };
};
