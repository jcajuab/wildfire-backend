export const resolveTargetEmail = (
  explicitEmail?: string,
): string | undefined => {
  if (!explicitEmail) {
    return undefined;
  }

  const normalized = explicitEmail.trim();
  return normalized.length > 0 ? normalized : undefined;
};
