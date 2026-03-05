import { type AuthSessionRepository } from "#/application/ports/auth";
import { env } from "#/env";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";
import { evalCachedRedisScript } from "#/infrastructure/redis/evalsha-script";

const authSessionPrefix = `${env.REDIS_KEY_PREFIX}:auth-session`;
const userSessionPrefix = `${env.REDIS_KEY_PREFIX}:auth-user-sessions`;

const sessionKey = (sessionId: string): string =>
  `${authSessionPrefix}:${sessionId}`;
const userSessionsKey = (userId: string): string =>
  `${userSessionPrefix}:${userId}`;
const toUnixSeconds = (value: Date): string =>
  String(Math.max(1, Math.ceil(value.getTime() / 1000)));

const REVOKE_BY_ID_SCRIPT = `
local userId = redis.call('HGET', KEYS[1], 'userId')
redis.call('DEL', KEYS[1])
if userId then
  redis.call('SREM', ARGV[1] .. ':' .. userId, ARGV[2])
end
return 1
`;

export class AuthSessionRedisRepository implements AuthSessionRepository {
  async create(input: {
    id: string;
    userId: string;
    expiresAt: Date;
  }): Promise<void> {
    const redis = await getRedisCommandClient();
    const key = sessionKey(input.id);

    await executeRedisCommand<number>(redis, [
      "HSET",
      key,
      "userId",
      input.userId,
    ]);
    await executeRedisCommand<number>(redis, [
      "EXPIREAT",
      key,
      toUnixSeconds(input.expiresAt),
    ]);
    await executeRedisCommand<number>(redis, [
      "SADD",
      userSessionsKey(input.userId),
      input.id,
    ]);
  }

  async extendExpiry(sessionId: string, expiresAt: Date): Promise<void> {
    const redis = await getRedisCommandClient();
    await executeRedisCommand<number>(redis, [
      "EXPIREAT",
      sessionKey(sessionId),
      toUnixSeconds(expiresAt),
    ]);
  }

  async revokeById(sessionId: string): Promise<void> {
    const redis = await getRedisCommandClient();
    const key = sessionKey(sessionId);
    await evalCachedRedisScript({
      redis,
      scriptName: "auth-session:revoke-by-id",
      script: REVOKE_BY_ID_SCRIPT,
      keys: [key],
      args: [userSessionPrefix, sessionId],
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    const redis = await getRedisCommandClient();
    const indexKey = userSessionsKey(userId);
    const sessionIds = await executeRedisCommand<string[]>(redis, [
      "SMEMBERS",
      indexKey,
    ]);

    if (sessionIds.length === 0) {
      await executeRedisCommand<number>(redis, ["DEL", indexKey]);
      return;
    }

    await executeRedisCommand<number>(redis, [
      "DEL",
      ...sessionIds.map((sessionId) => sessionKey(sessionId)),
      indexKey,
    ]);
  }

  async isActive(sessionId: string, _now: Date): Promise<boolean> {
    const redis = await getRedisCommandClient();
    const exists = await executeRedisCommand<number>(redis, [
      "EXISTS",
      sessionKey(sessionId),
    ]);
    return exists === 1;
  }

  async isOwnedByUser(
    sessionId: string,
    userId: string,
    _now: Date,
  ): Promise<boolean> {
    const redis = await getRedisCommandClient();
    const storedUserId = await executeRedisCommand<string | null>(redis, [
      "HGET",
      sessionKey(sessionId),
      "userId",
    ]);
    return storedUserId === userId;
  }
}
