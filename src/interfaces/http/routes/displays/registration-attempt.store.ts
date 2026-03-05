import { randomUUID } from "node:crypto";
import { env } from "#/env";
import { getRedisCommandClient } from "#/infrastructure/redis/client";
import { evalCachedRedisScript } from "#/infrastructure/redis/evalsha-script";

export interface RegistrationAttemptCode {
  code: string;
  codeHash: string;
  pairingCodeId: string;
  expiresAt: Date;
}

export interface DisplayRegistrationAttemptStore {
  createOrReplaceOpenAttempt(input: {
    createdById: string;
    activeCode: RegistrationAttemptCode;
  }): Promise<{ attemptId: string; invalidatedPairingCodeId: string | null }>;
  rotateCode(input: {
    attemptId: string;
    createdById: string;
    nextCode: RegistrationAttemptCode;
  }): Promise<{ invalidatedPairingCodeId: string | null } | null>;
  closeAttempt(input: {
    attemptId: string;
    createdById: string;
  }): Promise<{ invalidatedPairingCodeId: string | null } | null>;
  isAttemptOwnedBy(input: {
    attemptId: string;
    createdById: string;
  }): Promise<boolean>;
  consumeCodeHash(input: {
    codeHash: string;
    now: Date;
  }): Promise<{ attemptId: string; pairingCodeId: string } | null>;
  bindSessionAttempt(input: {
    sessionId: string;
    attemptId: string;
  }): Promise<void>;
  consumeSessionAttemptId(sessionId: string): Promise<string | null>;
}

interface RegistrationAttemptRecord {
  id: string;
  createdById: string;
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

const toUnixSeconds = (value: number): string =>
  String(Math.max(1, Math.ceil(value / 1000)));

const toScriptString = (value: unknown): string =>
  typeof value === "string" ? value : value == null ? "" : String(value);

const parseMilliseconds = (value: string | undefined): number | null => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseRegistrationAttempt = (
  value: Record<string, string>,
): RegistrationAttemptRecord | null => {
  const id = value.id;
  const createdById = value.createdById;
  const createdAtMs = parseMilliseconds(value.createdAtMs);
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof createdById !== "string" ||
    createdById.length === 0 ||
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
    createdById,
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

const CREATE_OR_REPLACE_OPEN_ATTEMPT_SCRIPT = `
local openAttemptKey = KEYS[1]

local attemptPrefix = ARGV[1]
local codeIndexPrefix = ARGV[2]
local createdById = ARGV[3]
local nowMs = tonumber(ARGV[4])
local staleTtlMs = tonumber(ARGV[5])
local newAttemptId = ARGV[6]
local newCodeHash = ARGV[7]
local newPairingCodeId = ARGV[8]
local newCodeExpiresAtMs = ARGV[9]
local newAttemptTtlMs = tonumber(ARGV[10])
local newCodeExpiresAtSec = tonumber(ARGV[11])

local existingAttemptId = redis.call('GET', openAttemptKey)
local invalidatedPairingCodeId = ''

if existingAttemptId and existingAttemptId ~= '' then
  local existingAttemptKey = attemptPrefix .. ':' .. existingAttemptId
  local existingCreatedById = redis.call('HGET', existingAttemptKey, 'createdById')
  if existingCreatedById and existingCreatedById ~= '' then
    local existingCodeHash = redis.call('HGET', existingAttemptKey, 'activeCodeHash')
    local existingPairingCodeId = redis.call('HGET', existingAttemptKey, 'activePairingCodeId')
    if existingCodeHash and existingCodeHash ~= '' and existingPairingCodeId and existingPairingCodeId ~= '' then
      redis.call('DEL', codeIndexPrefix .. ':' .. existingCodeHash)
      invalidatedPairingCodeId = existingPairingCodeId
    end

    redis.call(
      'HSET',
      existingAttemptKey,
      'closedAtMs', tostring(nowMs),
      'activeCodeHash', '',
      'activePairingCodeId', '',
      'activeCodeExpiresAtMs', ''
    )
    redis.call('PEXPIRE', existingAttemptKey, staleTtlMs)
  else
    redis.call('DEL', openAttemptKey)
  end
end

local newAttemptKey = attemptPrefix .. ':' .. newAttemptId
redis.call(
  'HSET',
  newAttemptKey,
  'id', newAttemptId,
  'createdById', createdById,
  'createdAtMs', tostring(nowMs),
  'closedAtMs', '',
  'activeCodeHash', newCodeHash,
  'activePairingCodeId', newPairingCodeId,
  'activeCodeExpiresAtMs', newCodeExpiresAtMs
)
redis.call('PEXPIRE', newAttemptKey, newAttemptTtlMs)
redis.call('SET', openAttemptKey, newAttemptId, 'PX', newAttemptTtlMs)
redis.call('SET', codeIndexPrefix .. ':' .. newCodeHash, newAttemptId, 'EXAT', newCodeExpiresAtSec)

return {newAttemptId, invalidatedPairingCodeId}
`;

const ROTATE_CODE_SCRIPT = `
local attemptKey = KEYS[1]
local openAttemptKey = KEYS[2]
local nextCodeIndexKey = KEYS[3]

local codeIndexPrefix = ARGV[1]
local expectedCreatedById = ARGV[2]
local nextCodeHash = ARGV[3]
local nextPairingCodeId = ARGV[4]
local nextCodeExpiresAtMs = ARGV[5]
local attemptTtlMs = tonumber(ARGV[6])
local nextCodeExpiresAtSec = tonumber(ARGV[7])

local attemptId = redis.call('HGET', attemptKey, 'id')
if (not attemptId) or attemptId == '' then
  return {'not_found', ''}
end

local createdById = redis.call('HGET', attemptKey, 'createdById')
if (not createdById) or createdById ~= expectedCreatedById then
  return {'not_found', ''}
end

local closedAtMs = redis.call('HGET', attemptKey, 'closedAtMs')
if closedAtMs and closedAtMs ~= '' then
  return {'closed', ''}
end

local invalidatedPairingCodeId = ''
local activeCodeHash = redis.call('HGET', attemptKey, 'activeCodeHash')
local activePairingCodeId = redis.call('HGET', attemptKey, 'activePairingCodeId')

if activeCodeHash and activeCodeHash ~= '' and activePairingCodeId and activePairingCodeId ~= '' then
  redis.call('DEL', codeIndexPrefix .. ':' .. activeCodeHash)
  invalidatedPairingCodeId = activePairingCodeId
end

redis.call(
  'HSET',
  attemptKey,
  'activeCodeHash', nextCodeHash,
  'activePairingCodeId', nextPairingCodeId,
  'activeCodeExpiresAtMs', nextCodeExpiresAtMs
)
redis.call('PEXPIRE', attemptKey, attemptTtlMs)
redis.call('SET', openAttemptKey, attemptId, 'PX', attemptTtlMs)
redis.call('SET', nextCodeIndexKey, attemptId, 'EXAT', nextCodeExpiresAtSec)

return {'ok', invalidatedPairingCodeId}
`;

const CLOSE_ATTEMPT_SCRIPT = `
local attemptKey = KEYS[1]
local openAttemptKey = KEYS[2]

local codeIndexPrefix = ARGV[1]
local expectedCreatedById = ARGV[2]
local nowMs = tonumber(ARGV[3])
local staleTtlMs = tonumber(ARGV[4])

local createdById = redis.call('HGET', attemptKey, 'createdById')
if (not createdById) or createdById ~= expectedCreatedById then
  return {'not_found', ''}
end

local closedAtMs = redis.call('HGET', attemptKey, 'closedAtMs')
if closedAtMs and closedAtMs ~= '' then
  return {'already_closed', ''}
end

local invalidatedPairingCodeId = ''
local activeCodeHash = redis.call('HGET', attemptKey, 'activeCodeHash')
local activePairingCodeId = redis.call('HGET', attemptKey, 'activePairingCodeId')

if activeCodeHash and activeCodeHash ~= '' and activePairingCodeId and activePairingCodeId ~= '' then
  redis.call('DEL', codeIndexPrefix .. ':' .. activeCodeHash)
  invalidatedPairingCodeId = activePairingCodeId
end

redis.call(
  'HSET',
  attemptKey,
  'closedAtMs', tostring(nowMs),
  'activeCodeHash', '',
  'activePairingCodeId', '',
  'activeCodeExpiresAtMs', ''
)
redis.call('PEXPIRE', attemptKey, staleTtlMs)
redis.call('DEL', openAttemptKey)

return {'closed', invalidatedPairingCodeId}
`;

const CONSUME_CODE_HASH_SCRIPT = `
local attemptId = redis.call('GET', KEYS[1])
if (not attemptId) then
  return {'', ''}
end

local attemptKey = ARGV[1] .. ':' .. attemptId
local createdById = redis.call('HGET', attemptKey, 'createdById')
if (not createdById) or createdById == '' then
  redis.call('DEL', KEYS[1])
  return {'', ''}
end

local closedAtMs = redis.call('HGET', attemptKey, 'closedAtMs')
local activeCodeHash = redis.call('HGET', attemptKey, 'activeCodeHash')
local activePairingCodeId = redis.call('HGET', attemptKey, 'activePairingCodeId')
local activeCodeExpiresAtMs = tonumber(redis.call('HGET', attemptKey, 'activeCodeExpiresAtMs'))

if (closedAtMs and closedAtMs ~= '') or (not activeCodeHash) or activeCodeHash == '' or (not activePairingCodeId) or activePairingCodeId == '' or (not activeCodeExpiresAtMs) then
  redis.call('DEL', KEYS[1])
  return {'', ''}
end

if activeCodeHash ~= ARGV[2] then
  return {'', ''}
end

if activeCodeExpiresAtMs <= tonumber(ARGV[3]) then
  redis.call('DEL', KEYS[1])
  redis.call('HSET', attemptKey, 'activeCodeHash', '', 'activePairingCodeId', '', 'activeCodeExpiresAtMs', '')
  redis.call('PEXPIRE', attemptKey, tonumber(ARGV[4]))
  return {'', ''}
end

redis.call('DEL', KEYS[1])
redis.call('HSET', attemptKey, 'activeCodeHash', '', 'activePairingCodeId', '', 'activeCodeExpiresAtMs', '')
redis.call('PEXPIRE', attemptKey, tonumber(ARGV[4]))

return {attemptId, activePairingCodeId}
`;

export class RedisDisplayRegistrationAttemptStore
  implements DisplayRegistrationAttemptStore
{
  async createOrReplaceOpenAttempt(input: {
    createdById: string;
    activeCode: RegistrationAttemptCode;
  }): Promise<{ attemptId: string; invalidatedPairingCodeId: string | null }> {
    const redis = await getRedisCommandClient();
    const nowMs = Date.now();
    const attemptId = randomUUID();
    const activeCodeExpiresAtMs = input.activeCode.expiresAt.getTime();
    const attemptTtlMs = getAttemptTtlMs({
      nowMs,
      activeCodeExpiresAtMs,
    });

    const result = await evalCachedRedisScript({
      redis,
      scriptName: "display-registration-attempt:create-or-replace-open-attempt",
      script: CREATE_OR_REPLACE_OPEN_ATTEMPT_SCRIPT,
      keys: [openAttemptByUserKey(input.createdById)],
      args: [
        attemptPrefix,
        attemptByCodeHashPrefix,
        input.createdById,
        String(nowMs),
        String(staleTtlMs),
        attemptId,
        input.activeCode.codeHash,
        input.activeCode.pairingCodeId,
        String(activeCodeExpiresAtMs),
        String(attemptTtlMs),
        toUnixSeconds(activeCodeExpiresAtMs),
      ],
    });

    const createdAttemptId = Array.isArray(result)
      ? toScriptString(result[0])
      : attemptId;
    const invalidatedPairingCodeId = Array.isArray(result)
      ? toScriptString(result[1])
      : "";

    return {
      attemptId: createdAttemptId.length > 0 ? createdAttemptId : attemptId,
      invalidatedPairingCodeId:
        invalidatedPairingCodeId.length > 0 ? invalidatedPairingCodeId : null,
    };
  }

  async rotateCode(input: {
    attemptId: string;
    createdById: string;
    nextCode: RegistrationAttemptCode;
  }): Promise<{
    invalidatedPairingCodeId: string | null;
  } | null> {
    const redis = await getRedisCommandClient();
    const nowMs = Date.now();
    const nextCodeExpiresAtMs = input.nextCode.expiresAt.getTime();
    const attemptTtlMs = getAttemptTtlMs({
      nowMs,
      activeCodeExpiresAtMs: nextCodeExpiresAtMs,
    });

    const result = await evalCachedRedisScript({
      redis,
      scriptName: "display-registration-attempt:rotate-code",
      script: ROTATE_CODE_SCRIPT,
      keys: [
        attemptKey(input.attemptId),
        openAttemptByUserKey(input.createdById),
        attemptByCodeHashKey(input.nextCode.codeHash),
      ],
      args: [
        attemptByCodeHashPrefix,
        input.createdById,
        input.nextCode.codeHash,
        input.nextCode.pairingCodeId,
        String(nextCodeExpiresAtMs),
        String(attemptTtlMs),
        toUnixSeconds(nextCodeExpiresAtMs),
      ],
    });

    if (!Array.isArray(result)) {
      return null;
    }

    const status = toScriptString(result[0]);
    if (status !== "ok") {
      return null;
    }

    const invalidatedPairingCodeId = toScriptString(result[1]);
    return {
      invalidatedPairingCodeId:
        invalidatedPairingCodeId.length > 0 ? invalidatedPairingCodeId : null,
    };
  }

  async closeAttempt(input: {
    attemptId: string;
    createdById: string;
  }): Promise<{ invalidatedPairingCodeId: string | null } | null> {
    const redis = await getRedisCommandClient();
    const result = await evalCachedRedisScript({
      redis,
      scriptName: "display-registration-attempt:close-attempt",
      script: CLOSE_ATTEMPT_SCRIPT,
      keys: [
        attemptKey(input.attemptId),
        openAttemptByUserKey(input.createdById),
      ],
      args: [
        attemptByCodeHashPrefix,
        input.createdById,
        String(Date.now()),
        String(staleTtlMs),
      ],
    });

    if (!Array.isArray(result)) {
      return null;
    }

    const status = toScriptString(result[0]);
    if (status === "not_found") {
      return null;
    }

    const invalidatedPairingCodeId = toScriptString(result[1]);
    return {
      invalidatedPairingCodeId:
        invalidatedPairingCodeId.length > 0 ? invalidatedPairingCodeId : null,
    };
  }

  async isAttemptOwnedBy(input: {
    attemptId: string;
    createdById: string;
  }): Promise<boolean> {
    const redis = await getRedisCommandClient();
    const attempt = parseRegistrationAttempt(
      await redis.hGetAll(attemptKey(input.attemptId)),
    );
    return attempt?.createdById === input.createdById;
  }

  async consumeCodeHash(input: {
    codeHash: string;
    now: Date;
  }): Promise<{ attemptId: string; pairingCodeId: string } | null> {
    const redis = await getRedisCommandClient();
    const result = await evalCachedRedisScript({
      redis,
      scriptName: "display-registration-attempt:consume-code-hash",
      script: CONSUME_CODE_HASH_SCRIPT,
      keys: [attemptByCodeHashKey(input.codeHash)],
      args: [
        attemptPrefix,
        input.codeHash,
        String(input.now.getTime()),
        String(staleTtlMs),
      ],
    });

    if (!Array.isArray(result)) {
      return null;
    }

    const attemptId = toScriptString(result[0]);
    const pairingCodeId = toScriptString(result[1]);

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
    await redis.sendCommand([
      "SET",
      sessionAttemptKey(input.sessionId),
      input.attemptId,
      "PX",
      String(sessionTtlMs),
    ]);
  }

  async consumeSessionAttemptId(sessionId: string): Promise<string | null> {
    const redis = await getRedisCommandClient();
    const reply = toScriptString(
      await redis.sendCommand(["GETDEL", sessionAttemptKey(sessionId)]),
    );
    return reply.length > 0 ? reply : null;
  }
}
