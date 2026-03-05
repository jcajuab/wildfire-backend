import {
  type DisplayPairingSessionRecord,
  type DisplayPairingSessionRepository,
} from "#/application/ports/display-auth";
import { env } from "#/env";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";

const pairingSessionPrefix = `${env.REDIS_KEY_PREFIX}:display-pairing-session`;

const pairingSessionKey = (id: string): string =>
  `${pairingSessionPrefix}:${id}`;
const toUnixSeconds = (value: Date): string =>
  String(Math.max(1, Math.ceil(value.getTime() / 1000)));

interface StoredPairingSession {
  id: string;
  pairingCodeId: string;
  state: DisplayPairingSessionRecord["state"];
  challengeNonce: string;
  challengeExpiresAtMs: number;
  completedAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
}

const parseMilliseconds = (value: string | undefined): number | null => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseState = (
  value: string | undefined,
): DisplayPairingSessionRecord["state"] | null => {
  if (
    value === "open" ||
    value === "completed" ||
    value === "aborted" ||
    value === "expired"
  ) {
    return value;
  }

  return null;
};

const parseStoredPairingSession = (
  value: Record<string, string>,
): StoredPairingSession | null => {
  const id = value.id;
  const pairingCodeId = value.pairingCodeId;
  const challengeNonce = value.challengeNonce;
  const state = parseState(value.state);
  const challengeExpiresAtMs = parseMilliseconds(value.challengeExpiresAtMs);
  const createdAtMs = parseMilliseconds(value.createdAtMs);
  const updatedAtMs = parseMilliseconds(value.updatedAtMs);

  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof pairingCodeId !== "string" ||
    pairingCodeId.length === 0 ||
    typeof challengeNonce !== "string" ||
    challengeNonce.length === 0 ||
    state == null ||
    challengeExpiresAtMs == null ||
    createdAtMs == null ||
    updatedAtMs == null
  ) {
    return null;
  }

  return {
    id,
    pairingCodeId,
    state,
    challengeNonce,
    challengeExpiresAtMs,
    completedAtMs: parseMilliseconds(value.completedAtMs),
    createdAtMs,
    updatedAtMs,
  };
};

const toRecord = (
  value: StoredPairingSession,
): DisplayPairingSessionRecord => ({
  id: value.id,
  pairingCodeId: value.pairingCodeId,
  state: value.state,
  challengeNonce: value.challengeNonce,
  challengeExpiresAt: new Date(value.challengeExpiresAtMs).toISOString(),
  completedAt:
    value.completedAtMs == null
      ? null
      : new Date(value.completedAtMs).toISOString(),
  createdAt: new Date(value.createdAtMs).toISOString(),
  updatedAt: new Date(value.updatedAtMs).toISOString(),
});

export class DisplayPairingSessionRedisRepository
  implements DisplayPairingSessionRepository
{
  async create(input: {
    pairingCodeId: string;
    challengeNonce: string;
    challengeExpiresAt: Date;
  }): Promise<DisplayPairingSessionRecord> {
    const redis = await getRedisCommandClient();
    const id = crypto.randomUUID();
    const nowMs = Date.now();
    const challengeExpiresAtMs = input.challengeExpiresAt.getTime();

    await executeRedisCommand<number>(redis, [
      "HSET",
      pairingSessionKey(id),
      "id",
      id,
      "pairingCodeId",
      input.pairingCodeId,
      "state",
      "open",
      "challengeNonce",
      input.challengeNonce,
      "challengeExpiresAtMs",
      String(challengeExpiresAtMs),
      "completedAtMs",
      "",
      "createdAtMs",
      String(nowMs),
      "updatedAtMs",
      String(nowMs),
    ]);
    await executeRedisCommand<number>(redis, [
      "EXPIREAT",
      pairingSessionKey(id),
      toUnixSeconds(input.challengeExpiresAt),
    ]);

    return toRecord({
      id,
      pairingCodeId: input.pairingCodeId,
      state: "open",
      challengeNonce: input.challengeNonce,
      challengeExpiresAtMs,
      completedAtMs: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    });
  }

  async findOpenById(input: {
    id: string;
    now: Date;
  }): Promise<DisplayPairingSessionRecord | null> {
    const redis = await getRedisCommandClient();
    const stored = parseStoredPairingSession(
      await executeRedisCommand<Record<string, string>>(redis, [
        "HGETALL",
        pairingSessionKey(input.id),
      ]),
    );

    if (!stored) {
      return null;
    }

    if (
      stored.state !== "open" ||
      stored.challengeExpiresAtMs <= input.now.getTime()
    ) {
      return null;
    }

    return toRecord(stored);
  }

  async complete(id: string, completedAt: Date): Promise<boolean> {
    const redis = await getRedisCommandClient();
    const key = pairingSessionKey(id);
    const stored = parseStoredPairingSession(
      await executeRedisCommand<Record<string, string>>(redis, [
        "HGETALL",
        key,
      ]),
    );

    if (!stored) {
      return false;
    }

    const completedAtMs = completedAt.getTime();
    if (
      stored.state !== "open" ||
      stored.challengeExpiresAtMs <= completedAtMs
    ) {
      return false;
    }

    await executeRedisCommand<number>(redis, [
      "HSET",
      key,
      "state",
      "completed",
      "completedAtMs",
      String(completedAtMs),
      "updatedAtMs",
      String(completedAtMs),
    ]);

    return true;
  }
}
