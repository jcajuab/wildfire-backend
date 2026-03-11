export const toIsoString = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : value;

export const toNullableIsoString = (
  value: Date | string | null,
): string | null =>
  value == null ? null : value instanceof Date ? value.toISOString() : value;
