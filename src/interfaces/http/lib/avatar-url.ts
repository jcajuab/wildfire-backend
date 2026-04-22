import { type ContentStorage } from "#/application/ports/content";
import { env } from "#/env";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";

const avatarCacheKey = (avatarKey: string): string =>
  `${env.REDIS_KEY_PREFIX}:avatar:url:${avatarKey}`;

const avatarCacheTtl = (expiresInSeconds: number): number =>
  Math.max(60, expiresInSeconds - 60);

/** Run a single Redis command with connection + timeout guard. */
const redisGet = async (key: string): Promise<string | null> => {
  const redis = await getRedisCommandClient();
  return executeRedisCommand((signal) =>
    redis.withAbortSignal(signal).get(key),
  );
};

const redisSet = async (
  key: string,
  value: string,
  ttl: number,
): Promise<void> => {
  const redis = await getRedisCommandClient();
  await executeRedisCommand((signal) =>
    redis.withAbortSignal(signal).set(key, value, { EX: ttl }),
  );
};

const redisMget = async (keys: string[]): Promise<(string | null)[]> => {
  const redis = await getRedisCommandClient();
  return executeRedisCommand((signal) =>
    redis.withAbortSignal(signal).mGet(keys),
  );
};

/** Clear the cached presigned avatar URL from Redis so the next request generates a fresh one. */
export const clearAvatarUrlCache = async (avatarKey: string): Promise<void> => {
  try {
    const redis = await getRedisCommandClient();
    await executeRedisCommand((signal) =>
      redis.withAbortSignal(signal).del(avatarCacheKey(avatarKey)),
    );
  } catch {
    // Best-effort cache clear.
  }
};

/**
 * Returns a copy of the user with `avatarUrl` set (presigned) when `avatarKey` is present,
 * and without `avatarKey` so internal storage keys are not exposed in API responses.
 */
export async function addAvatarUrlToUser<
  T extends { avatarKey?: string | null },
>(
  user: T,
  storage: ContentStorage,
  expiresInSeconds: number,
): Promise<Omit<T, "avatarKey"> & { avatarUrl?: string }> {
  const { avatarKey, ...rest } = user;
  if (!avatarKey) {
    return rest as Omit<T, "avatarKey"> & { avatarUrl?: string };
  }

  try {
    const cached = await redisGet(avatarCacheKey(avatarKey));
    if (cached != null) {
      return { ...rest, avatarUrl: cached } as Omit<T, "avatarKey"> & {
        avatarUrl?: string;
      };
    }
  } catch {
    // Best-effort cache read; fall through to S3.
  }

  const avatarUrl = await storage.getPresignedDownloadUrl({
    key: avatarKey,
    expiresInSeconds,
  });

  try {
    await redisSet(
      avatarCacheKey(avatarKey),
      avatarUrl,
      avatarCacheTtl(expiresInSeconds),
    );
  } catch {
    // Best-effort cache write.
  }

  return { ...rest, avatarUrl } as Omit<T, "avatarKey"> & {
    avatarUrl?: string;
  };
}

export async function addAvatarUrlsToUsers<
  T extends { avatarKey?: string | null },
>(
  users: readonly T[],
  storage: ContentStorage,
  expiresInSeconds: number,
): Promise<Array<Omit<T, "avatarKey"> & { avatarUrl?: string }>> {
  const avatarKeys = Array.from(
    new Set(
      users
        .map((user) => user.avatarKey)
        .filter(
          (key): key is string => typeof key === "string" && key.length > 0,
        ),
    ),
  );

  const avatarUrlByKey = new Map<string, string>();

  // Attempt MGET from Redis for all keys at once.
  let missKeys = avatarKeys;
  if (avatarKeys.length > 0) {
    try {
      const cacheKeys = avatarKeys.map(avatarCacheKey);
      const results = await redisMget(cacheKeys);
      missKeys = [];
      for (let i = 0; i < avatarKeys.length; i++) {
        const avatarKey = avatarKeys[i];
        const cached = results[i];
        if (avatarKey == null) continue;
        if (cached != null) {
          avatarUrlByKey.set(avatarKey, cached);
        } else {
          missKeys.push(avatarKey);
        }
      }
    } catch {
      // Best-effort cache read; fall through to S3 for all keys.
      missKeys = avatarKeys;
    }
  }

  // Fetch from S3 only for cache misses.
  await Promise.all(
    missKeys.map(async (avatarKey) => {
      try {
        const avatarUrl = await storage.getPresignedDownloadUrl({
          key: avatarKey,
          expiresInSeconds,
        });
        avatarUrlByKey.set(avatarKey, avatarUrl);

        try {
          await redisSet(
            avatarCacheKey(avatarKey),
            avatarUrl,
            avatarCacheTtl(expiresInSeconds),
          );
        } catch {
          // Best-effort cache write.
        }
      } catch {
        // Best-effort enrichment only.
      }
    }),
  );

  return users.map((user) => {
    const { avatarKey, ...rest } = user;
    if (!avatarKey) {
      return rest as Omit<T, "avatarKey"> & { avatarUrl?: string };
    }

    const avatarUrl = avatarUrlByKey.get(avatarKey);
    return {
      ...rest,
      ...(avatarUrl ? { avatarUrl } : {}),
    } as Omit<T, "avatarKey"> & { avatarUrl?: string };
  });
}
