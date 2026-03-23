import { env } from "#/env";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";

export interface DisplayHeartbeatStore {
  touchSeen(displayId: string, at: Date): Promise<void>;
  getLastSeenAt(displayId: string): Promise<string | null>;
  getLastSeenAtMany(displayIds: string[]): Promise<Map<string, string>>;
}

const HEARTBEAT_TTL_SECONDS = 120;

const heartbeatKey = (displayId: string): string =>
  `${env.REDIS_KEY_PREFIX}:display:heartbeat:${displayId}`;

export class RedisDisplayHeartbeatStore implements DisplayHeartbeatStore {
  async touchSeen(displayId: string, at: Date): Promise<void> {
    const redis = await getRedisCommandClient();
    await executeRedisCommand(redis, [
      "SET",
      heartbeatKey(displayId),
      at.toISOString(),
      "EX",
      String(HEARTBEAT_TTL_SECONDS),
    ]);
  }

  async getLastSeenAt(displayId: string): Promise<string | null> {
    const redis = await getRedisCommandClient();
    const result = await executeRedisCommand<string | null>(redis, [
      "GET",
      heartbeatKey(displayId),
    ]);
    return result ?? null;
  }

  async getLastSeenAtMany(displayIds: string[]): Promise<Map<string, string>> {
    if (displayIds.length === 0) {
      return new Map();
    }

    const redis = await getRedisCommandClient();
    const keys = displayIds.map(heartbeatKey);
    const results = await executeRedisCommand<(string | null)[]>(redis, [
      "MGET",
      ...keys,
    ]);

    const map = new Map<string, string>();
    for (let i = 0; i < displayIds.length; i++) {
      const value = results[i];
      const displayId = displayIds[i];
      if (value != null && displayId != null) {
        map.set(displayId, value);
      }
    }
    return map;
  }
}
