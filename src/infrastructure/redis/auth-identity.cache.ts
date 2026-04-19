import { type AuthIdentityCache } from "#/application/ports/auth";
import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";

const identityKey = (userId: string): string =>
  `${env.REDIS_KEY_PREFIX}:auth:identity:${userId}`;

export class RedisAuthIdentityCache implements AuthIdentityCache {
  async getPermissions(
    userId: string,
  ): Promise<{ isAdmin: boolean; permissions: string[] } | null> {
    try {
      const redis = await getRedisCommandClient();
      const cached = await executeRedisCommand<string | null>(redis, [
        "GET",
        identityKey(userId),
      ]);
      if (cached != null) {
        return JSON.parse(cached) as {
          isAdmin: boolean;
          permissions: string[];
        };
      }
    } catch {
      logger.warn(
        { event: "auth.identity_cache.read_failed", userId },
        "Auth identity cache read failed, falling through to DB",
      );
    }
    return null;
  }

  async setPermissions(
    userId: string,
    value: { isAdmin: boolean; permissions: string[] },
    ttlSeconds: number,
  ): Promise<void> {
    try {
      const redis = await getRedisCommandClient();
      await executeRedisCommand(redis, [
        "SET",
        identityKey(userId),
        JSON.stringify(value),
        "EX",
        String(ttlSeconds),
      ]);
    } catch {
      // Best-effort cache write — DB result is already available
    }
  }

  async invalidatePermissions(userId: string): Promise<void> {
    try {
      const redis = await getRedisCommandClient();
      await executeRedisCommand(redis, ["DEL", identityKey(userId)]);
    } catch {
      logger.warn(
        { event: "auth.identity_cache.invalidation_failed", userId },
        "Auth identity cache invalidation failed",
      );
    }
  }
}
