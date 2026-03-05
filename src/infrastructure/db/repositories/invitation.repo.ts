import { type InvitationRepository } from "#/application/ports/auth";
import { env } from "#/env";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";

const invitationPrefix = `${env.REDIS_KEY_PREFIX}:invitation`;
const invitationCreatedIndexKey = `${invitationPrefix}:index:created`;
const invitationExpiryIndexKey = `${invitationPrefix}:index:expires`;

const invitationHashKey = (id: string): string => `${invitationPrefix}:${id}`;
const invitationTokenKey = (hashedToken: string): string =>
  `${invitationPrefix}:token:${hashedToken}`;
const invitationEmailKey = (email: string): string =>
  `${invitationPrefix}:email:${email}`;

const toUnixSeconds = (value: Date): string =>
  String(Math.max(1, Math.ceil(value.getTime() / 1000)));

interface StoredInvitation {
  id: string;
  hashedToken: string;
  email: string;
  name: string | null;
  expiresAtMs: number;
  acceptedAtMs: number | null;
  revokedAtMs: number | null;
  createdAtMs: number;
}

const parseMilliseconds = (value: string | undefined): number | null => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseStoredInvitation = (
  value: Record<string, string>,
): StoredInvitation | null => {
  const id = value.id;
  const hashedToken = value.hashedToken;
  const email = value.email;
  const expiresAtMs = parseMilliseconds(value.expiresAtMs);
  const createdAtMs = parseMilliseconds(value.createdAtMs);

  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof hashedToken !== "string" ||
    hashedToken.length === 0 ||
    typeof email !== "string" ||
    email.length === 0 ||
    expiresAtMs == null ||
    createdAtMs == null
  ) {
    return null;
  }

  return {
    id,
    hashedToken,
    email,
    name: value.name && value.name.length > 0 ? value.name : null,
    expiresAtMs,
    acceptedAtMs: parseMilliseconds(value.acceptedAtMs),
    revokedAtMs: parseMilliseconds(value.revokedAtMs),
    createdAtMs,
  };
};

const isActiveInvitation = (
  invitation: StoredInvitation,
  nowMs: number,
): boolean =>
  invitation.acceptedAtMs == null &&
  invitation.revokedAtMs == null &&
  invitation.expiresAtMs > nowMs;

export class InvitationRedisRepository implements InvitationRepository {
  async create(input: {
    id: string;
    hashedToken: string;
    email: string;
    name: string | null;
    invitedByUserId: string;
    expiresAt: Date;
  }): Promise<void> {
    const redis = await getRedisCommandClient();
    const nowMs = Date.now();
    const expiresAtMs = input.expiresAt.getTime();

    await executeRedisCommand<number>(redis, [
      "HSET",
      invitationHashKey(input.id),
      "id",
      input.id,
      "hashedToken",
      input.hashedToken,
      "email",
      input.email,
      "name",
      input.name ?? "",
      "invitedByUserId",
      input.invitedByUserId,
      "expiresAtMs",
      String(expiresAtMs),
      "acceptedAtMs",
      "",
      "revokedAtMs",
      "",
      "createdAtMs",
      String(nowMs),
      "updatedAtMs",
      String(nowMs),
    ]);
    await executeRedisCommand<string>(redis, [
      "SET",
      invitationTokenKey(input.hashedToken),
      input.id,
      "EXAT",
      toUnixSeconds(input.expiresAt),
    ]);
    await executeRedisCommand<number>(redis, [
      "SADD",
      invitationEmailKey(input.email),
      input.id,
    ]);
    await executeRedisCommand<number>(redis, [
      "ZADD",
      invitationCreatedIndexKey,
      String(nowMs),
      input.id,
    ]);
    await executeRedisCommand<number>(redis, [
      "ZADD",
      invitationExpiryIndexKey,
      String(expiresAtMs),
      input.id,
    ]);
  }

  async findActiveByHashedToken(
    hashedToken: string,
    now: Date,
  ): Promise<{ id: string; email: string; name: string | null } | null> {
    const redis = await getRedisCommandClient();
    const invitationId = await executeRedisCommand<string | null>(redis, [
      "GET",
      invitationTokenKey(hashedToken),
    ]);

    if (!invitationId) {
      return null;
    }

    const stored = parseStoredInvitation(
      await executeRedisCommand<Record<string, string>>(redis, [
        "HGETALL",
        invitationHashKey(invitationId),
      ]),
    );
    if (!stored) {
      await executeRedisCommand<number>(redis, [
        "DEL",
        invitationTokenKey(hashedToken),
      ]);
      return null;
    }

    if (!isActiveInvitation(stored, now.getTime())) {
      await executeRedisCommand<number>(redis, [
        "DEL",
        invitationTokenKey(hashedToken),
      ]);
      return null;
    }

    return {
      id: stored.id,
      email: stored.email,
      name: stored.name,
    };
  }

  async findById(input: {
    id: string;
  }): Promise<{ id: string; email: string; name: string | null } | null> {
    const redis = await getRedisCommandClient();
    const stored = parseStoredInvitation(
      await executeRedisCommand<Record<string, string>>(redis, [
        "HGETALL",
        invitationHashKey(input.id),
      ]),
    );
    if (!stored) {
      return null;
    }

    return {
      id: stored.id,
      email: stored.email,
      name: stored.name,
    };
  }

  async listRecent(input: { limit: number }): Promise<
    {
      id: string;
      email: string;
      name: string | null;
      expiresAt: Date;
      acceptedAt: Date | null;
      revokedAt: Date | null;
      createdAt: Date;
    }[]
  > {
    const redis = await getRedisCommandClient();
    const idsReply = await executeRedisCommand<unknown[]>(redis, [
      "ZREVRANGE",
      invitationCreatedIndexKey,
      "0",
      String(Math.max(0, input.limit - 1)),
    ]);

    const invitationIds = Array.isArray(idsReply)
      ? idsReply.filter((value): value is string => typeof value === "string")
      : [];

    const invitations: {
      id: string;
      email: string;
      name: string | null;
      expiresAt: Date;
      acceptedAt: Date | null;
      revokedAt: Date | null;
      createdAt: Date;
    }[] = [];

    for (const invitationId of invitationIds) {
      const stored = parseStoredInvitation(
        await executeRedisCommand<Record<string, string>>(redis, [
          "HGETALL",
          invitationHashKey(invitationId),
        ]),
      );
      if (!stored) {
        continue;
      }

      invitations.push({
        id: stored.id,
        email: stored.email,
        name: stored.name,
        expiresAt: new Date(stored.expiresAtMs),
        acceptedAt:
          stored.acceptedAtMs == null ? null : new Date(stored.acceptedAtMs),
        revokedAt:
          stored.revokedAtMs == null ? null : new Date(stored.revokedAtMs),
        createdAt: new Date(stored.createdAtMs),
      });
    }

    return invitations;
  }

  async revokeActiveByEmail(email: string, now: Date): Promise<void> {
    const redis = await getRedisCommandClient();
    const nowMs = now.getTime();
    const invitationIds = await executeRedisCommand<string[]>(redis, [
      "SMEMBERS",
      invitationEmailKey(email),
    ]);

    for (const invitationId of invitationIds) {
      const hashKey = invitationHashKey(invitationId);
      const stored = parseStoredInvitation(
        await executeRedisCommand<Record<string, string>>(redis, [
          "HGETALL",
          hashKey,
        ]),
      );
      if (!stored || !isActiveInvitation(stored, nowMs)) {
        continue;
      }

      await executeRedisCommand<number>(redis, [
        "HSET",
        hashKey,
        "revokedAtMs",
        String(nowMs),
        "updatedAtMs",
        String(nowMs),
      ]);
      await executeRedisCommand<number>(redis, [
        "DEL",
        invitationTokenKey(stored.hashedToken),
      ]);
    }
  }

  async markAccepted(id: string, acceptedAt: Date): Promise<void> {
    const redis = await getRedisCommandClient();
    const acceptedAtMs = acceptedAt.getTime();
    const hashKey = invitationHashKey(id);
    const stored = parseStoredInvitation(
      await executeRedisCommand<Record<string, string>>(redis, [
        "HGETALL",
        hashKey,
      ]),
    );

    if (!stored) {
      return;
    }

    await executeRedisCommand<number>(redis, [
      "HSET",
      hashKey,
      "acceptedAtMs",
      String(acceptedAtMs),
      "updatedAtMs",
      String(acceptedAtMs),
    ]);
    await executeRedisCommand<number>(redis, [
      "DEL",
      invitationTokenKey(stored.hashedToken),
    ]);
  }

  async deleteExpired(now: Date): Promise<void> {
    const redis = await getRedisCommandClient();
    const nowMs = now.getTime();
    const expiredReply = await executeRedisCommand<unknown[]>(redis, [
      "ZRANGEBYSCORE",
      invitationExpiryIndexKey,
      "-inf",
      String(nowMs),
    ]);

    const expiredIds = Array.isArray(expiredReply)
      ? expiredReply.filter(
          (value): value is string => typeof value === "string",
        )
      : [];

    for (const invitationId of expiredIds) {
      const hashKey = invitationHashKey(invitationId);
      const stored = parseStoredInvitation(
        await executeRedisCommand<Record<string, string>>(redis, [
          "HGETALL",
          hashKey,
        ]),
      );

      await executeRedisCommand<number>(redis, ["DEL", hashKey]);
      await executeRedisCommand<number>(redis, [
        "ZREM",
        invitationCreatedIndexKey,
        invitationId,
      ]);
      await executeRedisCommand<number>(redis, [
        "ZREM",
        invitationExpiryIndexKey,
        invitationId,
      ]);

      if (stored) {
        await executeRedisCommand<number>(redis, [
          "DEL",
          invitationTokenKey(stored.hashedToken),
        ]);
        await executeRedisCommand<number>(redis, [
          "SREM",
          invitationEmailKey(stored.email),
          invitationId,
        ]);
      }
    }
  }
}
