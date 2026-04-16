import { createHash, randomBytes } from "node:crypto";

export const createRefreshTokenSecret = (): string =>
  randomBytes(32).toString("base64url");

export const hashRefreshTokenSecret = (secret: string): string =>
  createHash("sha256").update(secret).digest("hex");

export const buildRefreshTokenValue = (
  sessionId: string,
  secret: string,
): string => sessionId + "." + secret;

export const parseRefreshTokenValue = (
  value: string,
): { sessionId: string; secret: string } | null => {
  const separatorIndex = value.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    return null;
  }

  const sessionId = value.slice(0, separatorIndex).trim();
  const secret = value.slice(separatorIndex + 1).trim();
  if (sessionId.length === 0 || secret.length === 0) {
    return null;
  }

  return { sessionId, secret };
};
