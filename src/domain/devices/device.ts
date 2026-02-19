export class DeviceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceValidationError";
  }
}

export interface DeviceInput {
  name: string;
  identifier: string;
  deviceFingerprint?: string | null;
  location?: string | null;
  ipAddress?: string | null;
  macAddress?: string | null;
  screenWidth?: number | null;
  screenHeight?: number | null;
  outputType?: string | null;
  orientation?: "LANDSCAPE" | "PORTRAIT" | null;
}

export interface DeviceProps {
  name: string;
  identifier: string;
  deviceFingerprint: string | null;
  location: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  screenWidth: number | null;
  screenHeight: number | null;
  outputType: string | null;
  orientation: "LANDSCAPE" | "PORTRAIT" | null;
}

const normalize = (value: string) => value.trim();

export const createDeviceProps = (input: DeviceInput): DeviceProps => {
  const name = normalize(input.name);
  const identifier = normalize(input.identifier);

  if (!name) {
    throw new DeviceValidationError("Device name is required");
  }

  if (!identifier) {
    throw new DeviceValidationError("Device identifier is required");
  }

  return {
    name,
    identifier,
    deviceFingerprint: input.deviceFingerprint
      ? (() => {
          const trimmed = input.deviceFingerprint.trim();
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
