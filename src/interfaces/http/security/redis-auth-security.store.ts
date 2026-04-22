import { env } from "#/env";
import {
  executeRedisCommand,
  getRedisCommandClient,
  getRedisScriptedCommandClient,
} from "#/infrastructure/redis/client";
import { parseMilliseconds } from "#/infrastructure/redis/utils";

export interface AuthSecurityStore {
  checkLoginAllowed(
    key: string,
    nowMs: number,
  ): Promise<{
    allowed: boolean;
    retryAfterSeconds?: number;
  }>;
  registerLoginFailure(input: {
    key: string;
    nowMs: number;
    windowSeconds: number;
    lockoutThreshold: number;
    lockoutSeconds: number;
  }): Promise<void>;
  clearLoginFailures(key: string): Promise<void>;
  consumeEndpointAttempt(input: {
    key: string;
    nowMs: number;
    windowSeconds: number;
    maxAttempts: number;
  }): Promise<boolean>;
  consumeEndpointAttemptWithStats(input: {
    key: string;
    nowMs: number;
    windowSeconds: number;
    maxAttempts: number;
  }): Promise<{
    allowed: boolean;
    limit: number;
    remaining: number;
    retryAfterSeconds: number;
    resetEpochSeconds: number;
  }>;
}

const loginAttemptPrefix = `${env.REDIS_KEY_PREFIX}:auth-security:login-attempt`;
const endpointAttemptPrefix = `${env.REDIS_KEY_PREFIX}:auth-security:endpoint-attempt`;

const loginAttemptKey = (key: string): string => `${loginAttemptPrefix}:${key}`;
const endpointAttemptKey = (key: string): string =>
  `${endpointAttemptPrefix}:${key}`;

const sanitizeTtlMs = (value: number): number =>
  Math.max(1_000, Math.trunc(value));

export class RedisAuthSecurityStore implements AuthSecurityStore {
  async checkLoginAllowed(
    key: string,
    nowMs: number,
  ): Promise<{
    allowed: boolean;
    retryAfterSeconds?: number;
  }> {
    const redis = await getRedisCommandClient();
    const lockedUntilRaw = await executeRedisCommand((signal) =>
      redis.withAbortSignal(signal).hGet(loginAttemptKey(key), "lockedUntilMs"),
    );
    const lockedUntilMs = parseMilliseconds(lockedUntilRaw ?? undefined);

    if (lockedUntilMs == null || lockedUntilMs <= nowMs) {
      return { allowed: true };
    }

    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((lockedUntilMs - nowMs) / 1000)),
    };
  }

  async registerLoginFailure(input: {
    key: string;
    nowMs: number;
    windowSeconds: number;
    lockoutThreshold: number;
    lockoutSeconds: number;
  }): Promise<void> {
    const redis = await getRedisScriptedCommandClient();
    const windowMs = input.windowSeconds * 1000;
    const lockoutMs = input.lockoutSeconds * 1000;
    const ttlMs = sanitizeTtlMs(Math.max(windowMs, lockoutMs) * 2);

    await redis.registerLoginFailure(
      [loginAttemptKey(input.key)],
      [
        String(input.nowMs),
        String(windowMs),
        String(input.lockoutThreshold),
        String(lockoutMs),
        String(ttlMs),
      ],
    );
  }

  async clearLoginFailures(key: string): Promise<void> {
    const redis = await getRedisCommandClient();
    await executeRedisCommand((signal) =>
      redis.withAbortSignal(signal).del(loginAttemptKey(key)),
    );
  }

  async consumeEndpointAttempt(input: {
    key: string;
    nowMs: number;
    windowSeconds: number;
    maxAttempts: number;
  }): Promise<boolean> {
    const stats = await this.consumeEndpointAttemptWithStats(input);
    return stats.allowed;
  }

  async consumeEndpointAttemptWithStats(input: {
    key: string;
    nowMs: number;
    windowSeconds: number;
    maxAttempts: number;
  }): Promise<{
    allowed: boolean;
    limit: number;
    remaining: number;
    retryAfterSeconds: number;
    resetEpochSeconds: number;
  }> {
    const redis = await getRedisScriptedCommandClient();
    const windowMs = input.windowSeconds * 1000;
    const ttlMs = sanitizeTtlMs(windowMs * 2);

    const result = await redis.consumeEndpointAttempt(
      [endpointAttemptKey(input.key)],
      [String(input.nowMs), String(windowMs), String(ttlMs)],
    );

    const firstAttemptAtMs = Array.isArray(result)
      ? parseMilliseconds(
          typeof result[0] === "string"
            ? result[0]
            : result[0] == null
              ? undefined
              : String(result[0]),
        )
      : null;
    const attemptCount = Array.isArray(result)
      ? parseMilliseconds(
          typeof result[1] === "string"
            ? result[1]
            : result[1] == null
              ? undefined
              : String(result[1]),
        )
      : null;

    const safeFirstAttemptAtMs = firstAttemptAtMs ?? input.nowMs;
    const safeAttemptCount = attemptCount ?? 1;

    const windowResetMs = safeFirstAttemptAtMs + windowMs;
    const allowed = safeAttemptCount <= input.maxAttempts;
    const remaining = Math.max(0, input.maxAttempts - safeAttemptCount);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((windowResetMs - input.nowMs) / 1000),
    );

    return {
      allowed,
      limit: input.maxAttempts,
      remaining,
      retryAfterSeconds,
      resetEpochSeconds: Math.ceil(windowResetMs / 1000),
    };
  }
}
