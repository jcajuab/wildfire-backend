import { type AuthSessionRepository } from "#/application/ports/auth";
import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";

const SESSION_TTL_SECONDS = 15;
const NULL_SENTINEL = "__revoked";
const NULL_TTL_SECONDS = 5;

const sessionKey = (sessionId: string): string =>
  `${env.REDIS_KEY_PREFIX}:session:${sessionId}`;

type CachedSessionData = {
  id: string;
  userId: string;
  familyId: string;
  currentJti: string;
  previousJti: string | null;
  previousJtiExpiresAt: string | null;
  expiresAt: string;
};

export class CachedAuthSessionRepository implements AuthSessionRepository {
  constructor(private readonly inner: AuthSessionRepository) {}

  async create(input: {
    id: string;
    userId: string;
    expiresAt: Date;
    familyId: string;
    currentJti: string;
  }): Promise<void> {
    return this.inner.create(input);
  }

  async extendExpiry(sessionId: string, expiresAt: Date): Promise<void> {
    await this.inner.extendExpiry(sessionId, expiresAt);
    await this.deleteKey(sessionId);
  }

  async revokeById(sessionId: string): Promise<void> {
    await this.inner.revokeById(sessionId);
    await this.deleteKey(sessionId);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.inner.revokeAllForUser(userId);
    // Cannot selectively invalidate without a user→sessions index.
    // The 15-second TTL ensures stale entries expire quickly.
  }

  async isActive(sessionId: string, now: Date): Promise<boolean> {
    return this.inner.isActive(sessionId, now);
  }

  async isOwnedByUser(
    sessionId: string,
    userId: string,
    now: Date,
  ): Promise<boolean> {
    return this.inner.isOwnedByUser(sessionId, userId, now);
  }

  async findBySessionId(sessionId: string): Promise<{
    id: string;
    userId: string;
    familyId: string;
    currentJti: string;
    previousJti: string | null;
    previousJtiExpiresAt: Date | null;
    expiresAt: Date;
  } | null> {
    try {
      const redis = await getRedisCommandClient();
      const cached = await executeRedisCommand<string | null>(redis, [
        "GET",
        sessionKey(sessionId),
      ]);

      if (cached === NULL_SENTINEL) {
        return null;
      }

      if (cached != null) {
        const data = JSON.parse(cached) as CachedSessionData;
        return {
          ...data,
          previousJtiExpiresAt: data.previousJtiExpiresAt
            ? new Date(data.previousJtiExpiresAt)
            : null,
          expiresAt: new Date(data.expiresAt),
        };
      }
    } catch {
      logger.warn(
        { event: "auth.session_cache.read_failed", sessionId },
        "Session cache read failed, falling through to DB",
      );
    }

    const session = await this.inner.findBySessionId(sessionId);

    try {
      const redis = await getRedisCommandClient();
      if (session == null) {
        await executeRedisCommand(redis, [
          "SET",
          sessionKey(sessionId),
          NULL_SENTINEL,
          "EX",
          String(NULL_TTL_SECONDS),
        ]);
      } else {
        const serialized = JSON.stringify({
          id: session.id,
          userId: session.userId,
          familyId: session.familyId,
          currentJti: session.currentJti,
          previousJti: session.previousJti,
          previousJtiExpiresAt:
            session.previousJtiExpiresAt?.toISOString() ?? null,
          expiresAt: session.expiresAt.toISOString(),
        } satisfies CachedSessionData);
        await executeRedisCommand(redis, [
          "SET",
          sessionKey(sessionId),
          serialized,
          "EX",
          String(SESSION_TTL_SECONDS),
        ]);
      }
    } catch {
      // Best-effort cache write
    }

    return session;
  }

  async updateCurrentJtiOptimistic(input: {
    sessionId: string;
    expectedCurrentJti: string;
    newJti: string;
    previousJti: string;
    previousJtiExpiresAt: Date;
    newExpiresAt: Date;
  }): Promise<boolean> {
    const result = await this.inner.updateCurrentJtiOptimistic(input);
    // Critical: invalidate cache so subsequent requests see the new JTI.
    // Stale currentJti in cache would cause false-positive family revocation.
    await this.deleteKey(input.sessionId);
    return result;
  }

  async revokeByFamilyId(familyId: string): Promise<number> {
    const count = await this.inner.revokeByFamilyId(familyId);
    // Family-based revocation: cannot selectively invalidate without index.
    // Short TTL (15s) ensures stale entries expire quickly.
    return count;
  }

  private async deleteKey(sessionId: string): Promise<void> {
    try {
      const redis = await getRedisCommandClient();
      await executeRedisCommand(redis, ["DEL", sessionKey(sessionId)]);
    } catch {
      logger.warn(
        { event: "auth.session_cache.invalidation_failed", sessionId },
        "Session cache invalidation failed",
      );
    }
  }
}
