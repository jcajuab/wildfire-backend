export const normalizeUsername = (value: string): string =>
  value.trim().toLowerCase();

export const normalizeQuery = (value: string | undefined): string | null => {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
};
