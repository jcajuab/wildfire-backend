export const toUnixSeconds = (value: Date): string =>
  String(Math.max(1, Math.ceil(value.getTime() / 1000)));

export const toUnixSecondsMs = (valueMs: number): string =>
  String(Math.max(1, Math.ceil(valueMs / 1000)));

export const toScriptString = (value: unknown): string =>
  typeof value === "string" ? value : value == null ? "" : String(value);

export const parseMilliseconds = (value: string | undefined): number | null => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};
