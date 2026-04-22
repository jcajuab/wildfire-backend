import { randomUUID } from "node:crypto";
import {
  type DisplayRegistrationAttemptStore,
  type RegistrationAttemptCode,
} from "#/application/ports/display-registration-attempt";
import { env } from "#/env";
import {
  executeRedisCommand,
  getRedisCommandClient,
  getRedisScriptedCommandClient,
} from "#/infrastructure/redis/client";
import { normalizeRedisHash } from "#/infrastructure/redis/hashes";
import {
  parseMilliseconds,
  toRedisValue,
  toUnixSecondsMs,
} from "#/infrastructure/redis/utils";

interface RegistrationAttemptRecord {
  id: string;
  ownerId: string;
  createdAtMs: number;
  closedAtMs: number | null;
  activeCodeHash: string | null;
  activePairingCodeId: string | null;
  activeCodeExpiresAtMs: number | null;
}

const attemptPrefix = `${env.REDIS_KEY_PREFIX}:display-registration-attempt`;
const attemptByCodeHashPrefix = `${attemptPrefix}:code`;
const staleTtlMs = 30 * 60 * 1000;
const sessionTtlMs = 30 * 60 * 1000;

const attemptKey = (attemptId: string): string =>
  `${attemptPrefix}:${attemptId}`;
const openAttemptByUserKey = (userId: string): string =>
  `${attemptPrefix}:open:${userId}`;
const attemptByCodeHashKey = (codeHash: string): string =>
  `${attemptByCodeHashPrefix}:${codeHash}`;
const sessionAttemptKey = (sessionId: string): string =>
  `${attemptPrefix}:session:${sessionId}`;

const parseRegistrationAttempt = (
  value: Record<string, string>,
): RegistrationAttemptRecord | null => {
  const id = value.id;
  const ownerId = value.ownerId;
  const createdAtMs = parseMilliseconds(value.createdAtMs);
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof ownerId !== "string" ||
    ownerId.length === 0 ||
    createdAtMs == null
  ) {
    return null;
  }

  const activeCodeHash =
    typeof value.activeCodeHash === "string" && value.activeCodeHash.length > 0
      ? value.activeCodeHash
      : null;
  const activePairingCodeId =
    typeof value.activePairingCodeId === "string" &&
    value.activePairingCodeId.length > 0
      ? value.activePairingCodeId
      : null;
  const activeCodeExpiresAtMs = parseMilliseconds(value.activeCodeExpiresAtMs);
  const closedAtMs = parseMilliseconds(value.closedAtMs);

  return {
    id,
    ownerId,
    createdAtMs,
    closedAtMs,
    activeCodeHash:
      activeCodeHash && activePairingCodeId && activeCodeExpiresAtMs != null
        ? activeCodeHash
        : null,
    activePairingCodeId:
      activeCodeHash && activePairingCodeId && activeCodeExpiresAtMs != null
        ? activePairingCodeId
        : null,
    activeCodeExpiresAtMs:
      activeCodeHash && activePairingCodeId && activeCodeExpiresAtMs != null
        ? activeCodeExpiresAtMs
        : null,
  };
};

const getAttemptTtlMs = (input: {
  nowMs: number;
  activeCodeExpiresAtMs: number | null;
}): number => {
  if (input.activeCodeExpiresAtMs == null) {
    return staleTtlMs;
  }

  return Math.max(
    staleTtlMs,
    input.activeCodeExpiresAtMs - input.nowMs + staleTtlMs,
  );
};

export class RedisDisplayRegistrationAttemptStore
  implements DisplayRegistrationAttemptStore
{
  async createOrReplaceOpenAttempt(input: {
    ownerId: string;
    activeCode: RegistrationAttemptCode;
  }): Promise<{ attemptId: string; invalidatedPairingCodeId: string | null }> {
    const redis = await getRedisScriptedCommandClient();
    const nowMs = Date.now();
    const attemptId = randomUUID();
    const activeCodeExpiresAtMs = input.activeCode.expiresAt.getTime();
    const attemptTtlMs = getAttemptTtlMs({
      nowMs,
      activeCodeExpiresAtMs,
    });

    const result = await redis.createOrReplaceOpenAttempt(
      [openAttemptByUserKey(input.ownerId)],
      [
        attemptPrefix,
        attemptByCodeHashPrefix,
        input.ownerId,
        String(nowMs),
        String(staleTtlMs),
        attemptId,
        input.activeCode.codeHash,
        input.activeCode.pairingCodeId,
        String(activeCodeExpiresAtMs),
        String(attemptTtlMs),
        toUnixSecondsMs(activeCodeExpiresAtMs),
      ],
    );

    const createdAttemptId = Array.isArray(result)
      ? toRedisValue(result[0])
      : attemptId;
    const invalidatedPairingCodeId = Array.isArray(result)
      ? toRedisValue(result[1])
      : "";

    return {
      attemptId: createdAttemptId.length > 0 ? createdAttemptId : attemptId,
      invalidatedPairingCodeId:
        invalidatedPairingCodeId.length > 0 ? invalidatedPairingCodeId : null,
    };
  }

  async rotateCode(input: {
    attemptId: string;
    ownerId: string;
    nextCode: RegistrationAttemptCode;
  }): Promise<{
    invalidatedPairingCodeId: string | null;
  } | null> {
    const redis = await getRedisScriptedCommandClient();
    const nowMs = Date.now();
    const nextCodeExpiresAtMs = input.nextCode.expiresAt.getTime();
    const attemptTtlMs = getAttemptTtlMs({
      nowMs,
      activeCodeExpiresAtMs: nextCodeExpiresAtMs,
    });

    const result = await redis.rotateCode(
      [
        attemptKey(input.attemptId),
        openAttemptByUserKey(input.ownerId),
        attemptByCodeHashKey(input.nextCode.codeHash),
      ],
      [
        attemptByCodeHashPrefix,
        input.ownerId,
        input.nextCode.codeHash,
        input.nextCode.pairingCodeId,
        String(nextCodeExpiresAtMs),
        String(attemptTtlMs),
        toUnixSecondsMs(nextCodeExpiresAtMs),
      ],
    );

    if (!Array.isArray(result)) {
      return null;
    }

    const status = toRedisValue(result[0]);
    if (status !== "ok") {
      return null;
    }

    const invalidatedPairingCodeId = toRedisValue(result[1]);
    return {
      invalidatedPairingCodeId:
        invalidatedPairingCodeId.length > 0 ? invalidatedPairingCodeId : null,
    };
  }

  async closeAttempt(input: {
    attemptId: string;
    ownerId: string;
  }): Promise<{ invalidatedPairingCodeId: string | null } | null> {
    const redis = await getRedisScriptedCommandClient();
    const result = await redis.closeAttempt(
      [attemptKey(input.attemptId), openAttemptByUserKey(input.ownerId)],
      [
        attemptByCodeHashPrefix,
        input.ownerId,
        String(Date.now()),
        String(staleTtlMs),
      ],
    );

    if (!Array.isArray(result)) {
      return null;
    }

    const status = toRedisValue(result[0]);
    if (status === "not_found") {
      return null;
    }

    const invalidatedPairingCodeId = toRedisValue(result[1]);
    return {
      invalidatedPairingCodeId:
        invalidatedPairingCodeId.length > 0 ? invalidatedPairingCodeId : null,
    };
  }

  async isAttemptOwnedBy(input: {
    attemptId: string;
    ownerId: string;
  }): Promise<boolean> {
    const redis = await getRedisCommandClient();
    const attempt = parseRegistrationAttempt(
      normalizeRedisHash(
        await executeRedisCommand<unknown>(redis, [
          "HGETALL",
          attemptKey(input.attemptId),
        ]),
      ),
    );
    return attempt?.ownerId === input.ownerId;
  }

  async consumeCodeHash(input: {
    codeHash: string;
    now: Date;
  }): Promise<{ attemptId: string; pairingCodeId: string } | null> {
    const redis = await getRedisScriptedCommandClient();
    const result = await redis.consumeCodeHash(
      [attemptByCodeHashKey(input.codeHash)],
      [
        attemptPrefix,
        input.codeHash,
        String(input.now.getTime()),
        String(staleTtlMs),
      ],
    );

    if (!Array.isArray(result)) {
      return null;
    }

    const attemptId = toRedisValue(result[0]);
    const pairingCodeId = toRedisValue(result[1]);

    if (attemptId.length === 0 || pairingCodeId.length === 0) {
      return null;
    }

    return { attemptId, pairingCodeId };
  }

  async bindSessionAttempt(input: {
    sessionId: string;
    attemptId: string;
  }): Promise<void> {
    const redis = await getRedisCommandClient();
    await executeRedisCommand<void>(redis, [
      "SET",
      sessionAttemptKey(input.sessionId),
      input.attemptId,
      "PX",
      String(sessionTtlMs),
    ]);
  }

  async consumeSessionAttemptId(sessionId: string): Promise<string | null> {
    const redis = await getRedisCommandClient();
    const reply = toRedisValue(
      await executeRedisCommand<string | null>(redis, [
        "GETDEL",
        sessionAttemptKey(sessionId),
      ]),
    );
    return reply.length > 0 ? reply : null;
  }
}
