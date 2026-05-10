import { createHash } from "node:crypto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isSeedUuid = (value: string): boolean => UUID_PATTERN.test(value);

export const deterministicUuid = (seed: string): string => {
  const chars = createHash("sha256")
    .update(seed)
    .digest("hex")
    .slice(0, 32)
    .split("");

  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16] ?? "0", 16) & 0x3) | 0x8).toString(
    16,
  );

  const hex = chars.join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
};
