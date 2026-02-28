import { DEFAULT_ROOT_EMAIL } from "./constants";

export const resolveTargetEmail = (explicitEmail?: string): string => {
  const normalized = explicitEmail?.trim();
  if (normalized && normalized.length > 0) {
    return normalized;
  }

  return DEFAULT_ROOT_EMAIL;
};
