import { env } from "#/env";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";
import { evalCachedRedisScript } from "#/infrastructure/redis/evalsha-script";
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

const LOGIN_FAILURE_SCRIPT = `
local nowMs = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local lockoutThreshold = tonumber(ARGV[3])
local lockoutMs = tonumber(ARGV[4])
local ttlMs = tonumber(ARGV[5])

local firstAttemptAtMs = tonumber(redis.call('HGET', KEYS[1], 'firstAttemptAtMs'))
local attemptCount = tonumber(redis.call('HGET', KEYS[1], 'attemptCount'))
local lockedUntilMs = tonumber(redis.call('HGET', KEYS[1], 'lockedUntilMs'))

if (not firstAttemptAtMs) or (nowMs - firstAttemptAtMs > windowMs) then
  firstAttemptAtMs = nowMs
  attemptCount = 0
  lockedUntilMs = nil
end

attemptCount = attemptCount + 1
if attemptCount >= lockoutThreshold then
  lockedUntilMs = nowMs + lockoutMs
end

redis.call(
  'HSET',
  KEYS[1],
  'firstAttemptAtMs', tostring(firstAttemptAtMs),
  'attemptCount', tostring(attemptCount),
  'lockedUntilMs', lockedUntilMs and tostring(lockedUntilMs) or ''
)
redis.call('PEXPIRE', KEYS[1], ttlMs)

return {
  tostring(firstAttemptAtMs),
  tostring(attemptCount),
  lockedUntilMs and tostring(lockedUntilMs) or ''
}
`;

const ENDPOINT_ATTEMPT_SCRIPT = `
local nowMs = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local ttlMs = tonumber(ARGV[3])

local firstAttemptAtMs = tonumber(redis.call('HGET', KEYS[1], 'firstAttemptAtMs'))
local attemptCount = tonumber(redis.call('HGET', KEYS[1], 'attemptCount'))

if (not firstAttemptAtMs) or (nowMs - firstAttemptAtMs > windowMs) then
  firstAttemptAtMs = nowMs
  attemptCount = 0
end

attemptCount = attemptCount + 1

redis.call(
  'HSET',
  KEYS[1],
  'firstAttemptAtMs', tostring(firstAttemptAtMs),
  'attemptCount', tostring(attemptCount),
  'lockedUntilMs', ''
)
redis.call('PEXPIRE', KEYS[1], ttlMs)

return {
  tostring(firstAttemptAtMs),
  tostring(attemptCount)
}
`;

export class RedisAuthSecurityStore implements AuthSecurityStore {
  async checkLoginAllowed(
    key: string,
    nowMs: number,
  ): Promise<{
    allowed: boolean;
    retryAfterSeconds?: number;
  }> {
    const redis = await getRedisCommandClient();
    const lockedUntilRaw = await executeRedisCommand<string | null>(redis, [
      "HGET",
      loginAttemptKey(key),
      "lockedUntilMs",
    ]);
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
    const redis = await getRedisCommandClient();
    const windowMs = input.windowSeconds * 1000;
    const lockoutMs = input.lockoutSeconds * 1000;
    const ttlMs = sanitizeTtlMs(Math.max(windowMs, lockoutMs) * 2);

    await evalCachedRedisScript({
      redis,
      scriptName: "auth-security:register-login-failure",
      script: LOGIN_FAILURE_SCRIPT,
      keys: [loginAttemptKey(input.key)],
      args: [
        String(input.nowMs),
        String(windowMs),
        String(input.lockoutThreshold),
        String(lockoutMs),
        String(ttlMs),
      ],
    });
  }

  async clearLoginFailures(key: string): Promise<void> {
    const redis = await getRedisCommandClient();
    await executeRedisCommand<number>(redis, ["DEL", loginAttemptKey(key)]);
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
    const redis = await getRedisCommandClient();
    const windowMs = input.windowSeconds * 1000;
    const ttlMs = sanitizeTtlMs(windowMs * 2);

    const result = await evalCachedRedisScript({
      redis,
      scriptName: "auth-security:consume-endpoint-attempt",
      script: ENDPOINT_ATTEMPT_SCRIPT,
      keys: [endpointAttemptKey(input.key)],
      args: [String(input.nowMs), String(windowMs), String(ttlMs)],
    });

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
