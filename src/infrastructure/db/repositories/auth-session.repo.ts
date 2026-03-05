import { type AuthSessionRepository } from "#/application/ports/auth";
import { env } from "#/env";
import { getRedisCommandClient } from "#/infrastructure/redis/client";

const authSessionPrefix = `${env.REDIS_KEY_PREFIX}:auth-session`;
const userSessionPrefix = `${env.REDIS_KEY_PREFIX}:auth-user-sessions`;

const sessionKey = (sessionId: string): string =>
  `${authSessionPrefix}:${sessionId}`;
const userSessionsKey = (userId: string): string =>
  `${userSessionPrefix}:${userId}`;
const toUnixSeconds = (value: Date): string =>
  String(Math.max(1, Math.ceil(value.getTime() / 1000)));

export class AuthSessionRedisRepository implements AuthSessionRepository {
  async create(input: {
    id: string;
    userId: string;
    expiresAt: Date;
  }): Promise<void> {
    const redis = await getRedisCommandClient();
    const key = sessionKey(input.id);

    await redis.hSet(key, { userId: input.userId });
    await redis.sendCommand(["EXPIREAT", key, toUnixSeconds(input.expiresAt)]);
    await redis.sAdd(userSessionsKey(input.userId), input.id);
  }

  async extendExpiry(sessionId: string, expiresAt: Date): Promise<void> {
    const redis = await getRedisCommandClient();
    await redis.sendCommand([
      "EXPIREAT",
      sessionKey(sessionId),
      toUnixSeconds(expiresAt),
    ]);
  }

  async revokeById(sessionId: string): Promise<void> {
    const redis = await getRedisCommandClient();
    const key = sessionKey(sessionId);
    const userId = await redis.hGet(key, "userId");

    const transaction = redis.multi().del(key);
    if (typeof userId === "string" && userId.length > 0) {
      transaction.sRem(userSessionsKey(userId), sessionId);
    }
    await transaction.exec();
  }

  async revokeAllForUser(userId: string): Promise<void> {
    const redis = await getRedisCommandClient();
    const indexKey = userSessionsKey(userId);
    const sessionIds = await redis.sMembers(indexKey);

    if (sessionIds.length === 0) {
      await redis.del(indexKey);
      return;
    }

    const transaction = redis.multi();
    for (const sessionId of sessionIds) {
      transaction.del(sessionKey(sessionId));
    }
    transaction.del(indexKey);
    await transaction.exec();
  }

  async isActive(sessionId: string, _now: Date): Promise<boolean> {
    const redis = await getRedisCommandClient();
    const exists = await redis.exists(sessionKey(sessionId));
    return exists === 1;
  }

  async isOwnedByUser(
    sessionId: string,
    userId: string,
    _now: Date,
  ): Promise<boolean> {
    const redis = await getRedisCommandClient();
    const storedUserId = await redis.hGet(sessionKey(sessionId), "userId");
    return storedUserId === userId;
  }
}
