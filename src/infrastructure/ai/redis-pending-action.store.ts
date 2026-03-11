import { randomUUID } from "node:crypto";
import {
  type PendingAction,
  type PendingActionStore,
} from "#/application/ports/ai";
import { env } from "#/env";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";

const PENDING_ACTION_TTL_SECONDS = 300; // 5 minutes
const pendingActionPrefix = `${env.REDIS_KEY_PREFIX}:ai:pending`;

const pendingActionKey = (token: string): string =>
  `${pendingActionPrefix}:${token}`;

const userPendingActionsKey = (userId: string): string =>
  `${pendingActionPrefix}:user:${userId}`;

export class RedisPendingActionStore implements PendingActionStore {
  async create(
    input: Omit<PendingAction, "token" | "createdAt" | "expiresAt">,
  ): Promise<PendingAction> {
    const token = randomUUID();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + PENDING_ACTION_TTL_SECONDS * 1000,
    );

    const action: PendingAction = {
      ...input,
      token,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    const redis = await getRedisCommandClient();
    const key = pendingActionKey(token);
    const userKey = userPendingActionsKey(input.userId);

    await executeRedisCommand<string>(redis, [
      "SET",
      key,
      JSON.stringify(action),
      "EX",
      String(PENDING_ACTION_TTL_SECONDS),
    ]);

    await executeRedisCommand<number>(redis, ["SADD", userKey, token]);
    await executeRedisCommand<number>(redis, [
      "EXPIRE",
      userKey,
      String(PENDING_ACTION_TTL_SECONDS),
    ]);

    return action;
  }

  async get(
    token: string,
    userId: string,
    conversationId: string,
  ): Promise<PendingAction | null> {
    const redis = await getRedisCommandClient();
    const key = pendingActionKey(token);

    const data = await executeRedisCommand<string | null>(redis, ["GET", key]);
    if (data == null || data.length === 0) {
      return null;
    }

    let action: PendingAction;
    try {
      action = JSON.parse(data) as PendingAction;
    } catch {
      return null;
    }

    // Validate ownership AND conversation scope
    if (action.userId !== userId || action.conversationId !== conversationId) {
      return null;
    }

    return action;
  }

  async delete(token: string): Promise<boolean> {
    const redis = await getRedisCommandClient();
    const key = pendingActionKey(token);

    const data = await executeRedisCommand<string | null>(redis, ["GET", key]);
    if (data == null || data.length === 0) {
      return false;
    }

    let action: PendingAction;
    try {
      action = JSON.parse(data) as PendingAction;
    } catch {
      await executeRedisCommand<number>(redis, ["DEL", key]);
      return false;
    }

    const userKey = userPendingActionsKey(action.userId);

    await executeRedisCommand<number>(redis, ["DEL", key]);
    await executeRedisCommand<number>(redis, ["SREM", userKey, token]);

    return true;
  }

  async listForUser(userId: string): Promise<PendingAction[]> {
    const redis = await getRedisCommandClient();
    const userKey = userPendingActionsKey(userId);

    const tokens = await executeRedisCommand<string[]>(redis, [
      "SMEMBERS",
      userKey,
    ]);

    if (!Array.isArray(tokens) || tokens.length === 0) {
      return [];
    }

    const actions: PendingAction[] = [];
    for (const token of tokens) {
      const key = pendingActionKey(token);
      const data = await executeRedisCommand<string | null>(redis, [
        "GET",
        key,
      ]);
      if (data != null && data.length > 0) {
        try {
          actions.push(JSON.parse(data) as PendingAction);
        } catch {
          // Skip malformed entries
        }
      }
    }

    return actions;
  }
}
