import {
  DisplayPairingCodeCollisionError,
  type DisplayPairingCodeRecord,
  type DisplayPairingCodeRepository,
} from "#/application/ports/display-pairing";
import { env } from "#/env";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";
import { normalizeRedisHash } from "#/infrastructure/redis/hashes";
import {
  parseMilliseconds,
  toScriptString,
  toUnixSeconds,
} from "#/infrastructure/redis/utils";

const pairingCodePrefix = `${env.REDIS_KEY_PREFIX}:display-pairing-code`;
const pairingCodeLookupPrefix = `${env.REDIS_KEY_PREFIX}:display-pairing-code-lookup`;

const pairingCodeKey = (id: string): string => `${pairingCodePrefix}:${id}`;
const pairingCodeLookupKey = (codeHash: string): string =>
  `${pairingCodeLookupPrefix}:${codeHash}`;

interface StoredPairingCode {
  id: string;
  codeHash: string;
  expiresAtMs: number;
  usedAtMs: number | null;
  ownerId: string;
  createdAtMs: number;
  updatedAtMs: number;
}

const parseStoredPairingCode = (
  value: Record<string, string>,
): StoredPairingCode | null => {
  const id = value.id;
  const codeHash = value.codeHash;
  const ownerId = value.ownerId;
  const expiresAtMs = parseMilliseconds(value.expiresAtMs);
  const createdAtMs = parseMilliseconds(value.createdAtMs);
  const updatedAtMs = parseMilliseconds(value.updatedAtMs);

  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof codeHash !== "string" ||
    codeHash.length === 0 ||
    typeof ownerId !== "string" ||
    ownerId.length === 0 ||
    expiresAtMs == null ||
    createdAtMs == null ||
    updatedAtMs == null
  ) {
    return null;
  }

  return {
    id,
    codeHash,
    expiresAtMs,
    usedAtMs: parseMilliseconds(value.usedAtMs),
    ownerId,
    createdAtMs,
    updatedAtMs,
  };
};

const mapStoredCodeToRecord = (
  value: StoredPairingCode,
): DisplayPairingCodeRecord => ({
  id: value.id,
  codeHash: value.codeHash,
  expiresAt: new Date(value.expiresAtMs).toISOString(),
  usedAt:
    value.usedAtMs == null ? null : new Date(value.usedAtMs).toISOString(),
  ownerId: value.ownerId,
  createdAt: new Date(value.createdAtMs).toISOString(),
  updatedAt: new Date(value.updatedAtMs).toISOString(),
});

export class DisplayPairingCodeRedisRepository
  implements DisplayPairingCodeRepository
{
  async create(input: {
    codeHash: string;
    expiresAt: Date;
    ownerId: string;
  }): Promise<DisplayPairingCodeRecord> {
    const redis = await getRedisCommandClient();
    const id = crypto.randomUUID();
    const nowMs = Date.now();
    const expiresAtMs = input.expiresAt.getTime();

    await executeRedisCommand<number>(redis, [
      "HSET",
      pairingCodeKey(id),
      "id",
      id,
      "codeHash",
      input.codeHash,
      "expiresAtMs",
      String(expiresAtMs),
      "usedAtMs",
      "",
      "ownerId",
      input.ownerId,
      "createdAtMs",
      String(nowMs),
      "updatedAtMs",
      String(nowMs),
    ]);

    const setResult = await executeRedisCommand<string>(redis, [
      "SET",
      pairingCodeLookupKey(input.codeHash),
      id,
      "EXAT",
      toUnixSeconds(input.expiresAt),
      "NX",
    ]);

    if (toScriptString(setResult) !== "OK") {
      await executeRedisCommand<number>(redis, ["DEL", pairingCodeKey(id)]);
      throw new DisplayPairingCodeCollisionError();
    }

    return mapStoredCodeToRecord({
      id,
      codeHash: input.codeHash,
      expiresAtMs,
      usedAtMs: null,
      ownerId: input.ownerId,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    });
  }

  async consumeValidCode(input: {
    codeHash: string;
    now: Date;
  }): Promise<DisplayPairingCodeRecord | null> {
    const redis = await getRedisCommandClient();
    const consumedId = toScriptString(
      await executeRedisCommand<string | null>(redis, [
        "GETDEL",
        pairingCodeLookupKey(input.codeHash),
      ]),
    );

    if (consumedId.length === 0) {
      return null;
    }

    const key = pairingCodeKey(consumedId);
    const stored = parseStoredPairingCode(
      normalizeRedisHash(
        await executeRedisCommand<unknown>(redis, ["HGETALL", key]),
      ),
    );
    if (!stored) {
      return null;
    }

    const nowMs = input.now.getTime();
    if (stored.usedAtMs != null || stored.expiresAtMs <= nowMs) {
      return null;
    }

    await executeRedisCommand<number>(redis, [
      "HSET",
      key,
      "usedAtMs",
      String(nowMs),
      "updatedAtMs",
      String(nowMs),
    ]);

    return mapStoredCodeToRecord({
      ...stored,
      usedAtMs: nowMs,
      updatedAtMs: nowMs,
    });
  }

  async invalidateById(input: { id: string; now: Date }): Promise<void> {
    const redis = await getRedisCommandClient();
    const key = pairingCodeKey(input.id);
    const stored = parseStoredPairingCode(
      normalizeRedisHash(
        await executeRedisCommand<unknown>(redis, ["HGETALL", key]),
      ),
    );

    if (!stored) {
      return;
    }

    const nowMs = input.now.getTime();
    if (stored.usedAtMs != null || stored.expiresAtMs <= nowMs) {
      return;
    }

    await executeRedisCommand<number>(redis, [
      "HSET",
      key,
      "usedAtMs",
      String(nowMs),
      "updatedAtMs",
      String(nowMs),
    ]);
    await executeRedisCommand<number>(redis, [
      "DEL",
      pairingCodeLookupKey(stored.codeHash),
    ]);
  }
}
