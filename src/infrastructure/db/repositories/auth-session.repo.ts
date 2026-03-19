import { and, eq, gt } from "drizzle-orm";
import { type AuthSessionRepository } from "#/application/ports/auth";
import { db } from "#/infrastructure/db/client";
import { authSessions } from "#/infrastructure/db/schema/auth-state.sql";

export class AuthSessionDbRepository implements AuthSessionRepository {
  async create(input: {
    id: string;
    userId: string;
    expiresAt: Date;
    familyId: string;
    currentJti: string;
  }): Promise<void> {
    const now = new Date();
    await db.insert(authSessions).values({
      id: input.id,
      userId: input.userId,
      expiresAt: input.expiresAt,
      familyId: input.familyId,
      currentJti: input.currentJti,
      createdAt: now,
      updatedAt: now,
    });
  }

  async extendExpiry(sessionId: string, expiresAt: Date): Promise<void> {
    await db
      .update(authSessions)
      .set({
        expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(authSessions.id, sessionId));
  }

  async revokeById(sessionId: string): Promise<void> {
    await db.delete(authSessions).where(eq(authSessions.id, sessionId));
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await db.delete(authSessions).where(eq(authSessions.userId, userId));
  }

  async isActive(sessionId: string, now: Date): Promise<boolean> {
    const rows = await db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(
        and(eq(authSessions.id, sessionId), gt(authSessions.expiresAt, now)),
      )
      .limit(1);
    return rows.length > 0;
  }

  async isOwnedByUser(
    sessionId: string,
    userId: string,
    now: Date,
  ): Promise<boolean> {
    const rows = await db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(
        and(
          eq(authSessions.id, sessionId),
          eq(authSessions.userId, userId),
          gt(authSessions.expiresAt, now),
        ),
      )
      .limit(1);
    return rows.length > 0;
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
    const now = new Date();
    const rows = await db
      .select({
        id: authSessions.id,
        userId: authSessions.userId,
        familyId: authSessions.familyId,
        currentJti: authSessions.currentJti,
        previousJti: authSessions.previousJti,
        previousJtiExpiresAt: authSessions.previousJtiExpiresAt,
        expiresAt: authSessions.expiresAt,
      })
      .from(authSessions)
      .where(
        and(eq(authSessions.id, sessionId), gt(authSessions.expiresAt, now)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async updateCurrentJtiOptimistic(input: {
    sessionId: string;
    expectedCurrentJti: string;
    newJti: string;
    previousJti: string;
    previousJtiExpiresAt: Date;
    newExpiresAt: Date;
  }): Promise<boolean> {
    const result = await db
      .update(authSessions)
      .set({
        currentJti: input.newJti,
        previousJti: input.previousJti,
        previousJtiExpiresAt: input.previousJtiExpiresAt,
        expiresAt: input.newExpiresAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(authSessions.id, input.sessionId),
          eq(authSessions.currentJti, input.expectedCurrentJti),
        ),
      );
    return (result[0]?.affectedRows ?? 0) > 0;
  }

  async revokeByFamilyId(familyId: string): Promise<number> {
    const result = await db
      .delete(authSessions)
      .where(eq(authSessions.familyId, familyId));
    return Number(result[0]?.affectedRows ?? 0);
  }
}
