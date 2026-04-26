import {
  type DisplayRegistrationLinkStore,
  type RegistrationLinkRecord,
} from "#/application/ports/display-registration-link";
import { env } from "#/env";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";
import { normalizeRedisHash } from "#/infrastructure/redis/hashes";
import { parseMilliseconds } from "#/infrastructure/redis/utils";

const LINK_TTL_MS = 5 * 60 * 1_000;
const KEY_PREFIX = `${env.REDIS_KEY_PREFIX}:display-registration-link`;

const linkKey = (token: string): string => `${KEY_PREFIX}:${token}`;

const parseRecord = (
  raw: Record<string, string>,
  token: string,
): RegistrationLinkRecord | null => {
  const slug = raw.slug;
  const displayName = raw.displayName;
  const output = raw.output;
  const challengeNonce = raw.challengeNonce;
  const attemptId = raw.attemptId;
  const ownerId = raw.ownerId;
  const resolutionWidth = parseMilliseconds(raw.resolutionWidth);
  const resolutionHeight = parseMilliseconds(raw.resolutionHeight);
  const expiresAtMs = parseMilliseconds(raw.expiresAtMs);

  if (
    !slug ||
    !displayName ||
    !output ||
    !challengeNonce ||
    !attemptId ||
    !ownerId ||
    resolutionWidth == null ||
    resolutionHeight == null ||
    expiresAtMs == null
  ) {
    return null;
  }

  let displayGroups: string[] = [];
  try {
    const parsed = JSON.parse(raw.displayGroups || "[]") as unknown;
    if (Array.isArray(parsed)) {
      displayGroups = parsed.filter((v): v is string => typeof v === "string");
    }
  } catch {
    displayGroups = [];
  }

  return {
    token,
    slug,
    displayName,
    output,
    resolutionWidth,
    resolutionHeight,
    displayGroups,
    challengeNonce,
    attemptId,
    ownerId,
    expiresAtMs,
  };
};

export class RedisDisplayRegistrationLinkStore
  implements DisplayRegistrationLinkStore
{
  async create(record: RegistrationLinkRecord): Promise<void> {
    const redis = await getRedisCommandClient();
    const key = linkKey(record.token);
    const fields: Record<string, string> = {
      slug: record.slug,
      displayName: record.displayName,
      output: record.output,
      resolutionWidth: String(record.resolutionWidth),
      resolutionHeight: String(record.resolutionHeight),
      displayGroups: JSON.stringify(record.displayGroups),
      challengeNonce: record.challengeNonce,
      attemptId: record.attemptId,
      ownerId: record.ownerId,
      expiresAtMs: String(record.expiresAtMs),
    };

    await executeRedisCommand(async (signal) => {
      const client = redis.withAbortSignal(signal);
      await client.hSet(key, fields);
      await client.pExpire(key, LINK_TTL_MS);
    });
  }

  async peek(token: string, now: Date): Promise<RegistrationLinkRecord | null> {
    const redis = await getRedisCommandClient();
    const raw = normalizeRedisHash(
      await executeRedisCommand((signal) =>
        redis.withAbortSignal(signal).hGetAll(linkKey(token)),
      ),
    );

    if (Object.keys(raw).length === 0) {
      return null;
    }

    const record = parseRecord(raw, token);
    if (!record || record.expiresAtMs <= now.getTime()) {
      return null;
    }
    return record;
  }

  async consume(
    token: string,
    now: Date,
  ): Promise<RegistrationLinkRecord | null> {
    const redis = await getRedisCommandClient();
    const key = linkKey(token);

    // Atomic read + delete using MULTI/EXEC
    const results = await executeRedisCommand(async (signal) => {
      const client = redis.withAbortSignal(signal);
      const multi = client.multi();
      multi.hGetAll(key);
      multi.del(key);
      return multi.exec();
    });

    if (!Array.isArray(results) || results.length < 2) {
      return null;
    }

    const raw = normalizeRedisHash(results[0]);
    if (Object.keys(raw).length === 0) {
      return null;
    }

    const record = parseRecord(raw, token);
    if (!record || record.expiresAtMs <= now.getTime()) {
      return null;
    }
    return record;
  }
}
