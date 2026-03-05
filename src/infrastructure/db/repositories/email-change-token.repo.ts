import { type EmailChangeTokenRepository } from "#/application/ports/auth";
import { env } from "#/env";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";

const prefix = `${env.REDIS_KEY_PREFIX}:email-change-token`;
const tokenKey = (hashedToken: string): string =>
  `${prefix}:token:${hashedToken}`;
const userKey = (userId: string): string => `${prefix}:user:${userId}`;
const toUnixSeconds = (value: Date): string =>
  String(Math.max(1, Math.ceil(value.getTime() / 1000)));

interface StoredEmailChangeToken {
  userId: string;
  email: string;
  expiresAtMs: number;
}

const parseStoredToken = (value: string): StoredEmailChangeToken | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed == null || typeof parsed !== "object") {
      return null;
    }
    const data = parsed as Record<string, unknown>;
    const userId = data.userId;
    const email = data.email;
    const expiresAtMs = data.expiresAtMs;
    if (
      typeof userId !== "string" ||
      typeof email !== "string" ||
      typeof expiresAtMs !== "number" ||
      !Number.isFinite(expiresAtMs)
    ) {
      return null;
    }
    return { userId, email, expiresAtMs };
  } catch {
    return null;
  }
};

export class EmailChangeTokenRedisRepository
  implements EmailChangeTokenRepository
{
  async store(input: {
    userId: string;
    email: string;
    hashedToken: string;
    expiresAt: Date;
  }): Promise<void> {
    const redis = await getRedisCommandClient();
    const existingHashedToken = await executeRedisCommand<string | null>(
      redis,
      ["GET", userKey(input.userId)],
    );

    if (existingHashedToken) {
      await executeRedisCommand<number>(redis, [
        "DEL",
        tokenKey(existingHashedToken),
      ]);
    }

    const payload: StoredEmailChangeToken = {
      userId: input.userId,
      email: input.email,
      expiresAtMs: input.expiresAt.getTime(),
    };

    await executeRedisCommand<void>(redis, [
      "SET",
      tokenKey(input.hashedToken),
      JSON.stringify(payload),
      "EXAT",
      toUnixSeconds(input.expiresAt),
    ]);
    await executeRedisCommand<void>(redis, [
      "SET",
      userKey(input.userId),
      input.hashedToken,
      "EXAT",
      toUnixSeconds(input.expiresAt),
    ]);
  }

  async findByHashedToken(
    hashedToken: string,
    now: Date,
  ): Promise<{ userId: string; email: string; expiresAt: Date } | null> {
    const redis = await getRedisCommandClient();
    const raw = await executeRedisCommand<string | null>(redis, [
      "GET",
      tokenKey(hashedToken),
    ]);
    if (!raw) {
      return null;
    }

    const token = parseStoredToken(raw);
    if (!token) {
      await executeRedisCommand<number>(redis, ["DEL", tokenKey(hashedToken)]);
      return null;
    }

    if (token.expiresAtMs <= now.getTime()) {
      await executeRedisCommand<number>(redis, [
        "DEL",
        tokenKey(hashedToken),
        userKey(token.userId),
      ]);
      return null;
    }

    return {
      userId: token.userId,
      email: token.email,
      expiresAt: new Date(token.expiresAtMs),
    };
  }

  async findPendingByUserId(
    userId: string,
    now: Date,
  ): Promise<{ email: string; expiresAt: Date } | null> {
    const redis = await getRedisCommandClient();
    const hashedToken = await executeRedisCommand<string | null>(redis, [
      "GET",
      userKey(userId),
    ]);
    if (!hashedToken) {
      return null;
    }

    const token = await this.findByHashedToken(hashedToken, now);
    if (!token) {
      await executeRedisCommand<number>(redis, ["DEL", userKey(userId)]);
      return null;
    }

    return {
      email: token.email,
      expiresAt: token.expiresAt,
    };
  }

  async consumeByHashedToken(hashedToken: string): Promise<void> {
    const redis = await getRedisCommandClient();
    const token = await this.findByHashedToken(hashedToken, new Date());
    await executeRedisCommand<number>(redis, ["DEL", tokenKey(hashedToken)]);
    if (!token) {
      return;
    }

    const linkedHashedToken = await executeRedisCommand<string | null>(redis, [
      "GET",
      userKey(token.userId),
    ]);
    if (linkedHashedToken === hashedToken) {
      await executeRedisCommand<number>(redis, ["DEL", userKey(token.userId)]);
    }
  }

  async deleteByUserId(userId: string): Promise<void> {
    const redis = await getRedisCommandClient();
    const hashedToken = await executeRedisCommand<string | null>(redis, [
      "GET",
      userKey(userId),
    ]);
    await executeRedisCommand<number>(redis, ["DEL", userKey(userId)]);
    if (hashedToken) {
      await executeRedisCommand<number>(redis, ["DEL", tokenKey(hashedToken)]);
    }
  }

  async deleteExpired(_now: Date): Promise<void> {
    return;
  }
}
