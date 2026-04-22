import { toRedisValue } from "#/infrastructure/redis/utils";

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object") {
    return false;
  }

  return Object.getPrototypeOf(value) === Object.prototype;
};

export const normalizeRedisHash = (value: unknown): Record<string, string> => {
  if (Array.isArray(value)) {
    const fields: Record<string, string> = {};

    for (let index = 0; index + 1 < value.length; index += 2) {
      const rawKey = value[index];
      const rawValue = value[index + 1];
      const key = toRedisValue(rawKey);
      if (key.length > 0) {
        fields[key] = toRedisValue(rawValue);
      }
    }

    return fields;
  }

  if (value instanceof Map) {
    const fields: Record<string, string> = {};
    for (const [rawKey, rawValue] of value.entries()) {
      const key = toRedisValue(rawKey);
      if (key.length > 0) {
        fields[key] = toRedisValue(rawValue);
      }
    }

    return fields;
  }

  if (!isObjectRecord(value)) {
    return {};
  }

  const fields: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (rawKey.length > 0) {
      fields[rawKey] = toRedisValue(rawValue);
    }
  }

  return fields;
};
