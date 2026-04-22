import { defineScript } from "@redis/client";
import { type CommandParser } from "@redis/client/dist/lib/client/parser";

const pushKeysAndArgs = (
  parser: CommandParser,
  keys: ReadonlyArray<string>,
  args: ReadonlyArray<string>,
): void => {
  for (const key of keys) parser.pushKey(key);
  for (const arg of args) parser.push(arg);
};

export const redisScripts = {
  createOrReplaceOpenAttempt: defineScript({
    NUMBER_OF_KEYS: 1,
    SCRIPT: `
local openAttemptKey = KEYS[1]

local attemptPrefix = ARGV[1]
local codeIndexPrefix = ARGV[2]
local ownerId = ARGV[3]
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
  local existingCreatedById = redis.call('HGET', existingAttemptKey, 'ownerId')
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
  'ownerId', ownerId,
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
`,
    parseCommand(
      parser: CommandParser,
      keys: ReadonlyArray<string>,
      args: ReadonlyArray<string>,
    ) {
      pushKeysAndArgs(parser, keys, args);
    },
    transformReply(reply: unknown) {
      return reply;
    },
  }),

  rotateCode: defineScript({
    NUMBER_OF_KEYS: 3,
    SCRIPT: `
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

local ownerId = redis.call('HGET', attemptKey, 'ownerId')
if (not ownerId) or ownerId ~= expectedCreatedById then
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
`,
    parseCommand(
      parser: CommandParser,
      keys: ReadonlyArray<string>,
      args: ReadonlyArray<string>,
    ) {
      pushKeysAndArgs(parser, keys, args);
    },
    transformReply(reply: unknown) {
      return reply;
    },
  }),

  closeAttempt: defineScript({
    NUMBER_OF_KEYS: 2,
    SCRIPT: `
local attemptKey = KEYS[1]
local openAttemptKey = KEYS[2]

local codeIndexPrefix = ARGV[1]
local expectedCreatedById = ARGV[2]
local nowMs = tonumber(ARGV[3])
local staleTtlMs = tonumber(ARGV[4])

local ownerId = redis.call('HGET', attemptKey, 'ownerId')
if (not ownerId) or ownerId ~= expectedCreatedById then
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
`,
    parseCommand(
      parser: CommandParser,
      keys: ReadonlyArray<string>,
      args: ReadonlyArray<string>,
    ) {
      pushKeysAndArgs(parser, keys, args);
    },
    transformReply(reply: unknown) {
      return reply;
    },
  }),

  registerLoginFailure: defineScript({
    NUMBER_OF_KEYS: 1,
    SCRIPT: `
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
`,
    parseCommand(
      parser: CommandParser,
      keys: ReadonlyArray<string>,
      args: ReadonlyArray<string>,
    ) {
      pushKeysAndArgs(parser, keys, args);
    },
    transformReply(reply: unknown) {
      return reply;
    },
  }),

  consumeEndpointAttempt: defineScript({
    NUMBER_OF_KEYS: 1,
    SCRIPT: `
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
`,
    parseCommand(
      parser: CommandParser,
      keys: ReadonlyArray<string>,
      args: ReadonlyArray<string>,
    ) {
      pushKeysAndArgs(parser, keys, args);
    },
    transformReply(reply: unknown) {
      return reply;
    },
  }),

  consumeCodeHash: defineScript({
    NUMBER_OF_KEYS: 1,
    SCRIPT: `
local attemptId = redis.call('GET', KEYS[1])
if (not attemptId) then
  return {'', ''}
end

local attemptKey = ARGV[1] .. ':' .. attemptId
local ownerId = redis.call('HGET', attemptKey, 'ownerId')
if (not ownerId) or ownerId == '' then
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
`,
    parseCommand(
      parser: CommandParser,
      keys: ReadonlyArray<string>,
      args: ReadonlyArray<string>,
    ) {
      pushKeysAndArgs(parser, keys, args);
    },
    transformReply(reply: unknown) {
      return reply;
    },
  }),
};
