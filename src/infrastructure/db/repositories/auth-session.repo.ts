import { and, eq, gt } from "drizzle-orm";
import { type AuthSessionRepository } from "#/application/ports/auth";
import { db } from "#/infrastructure/db/client";
import { authSessions } from "#/infrastructure/db/schema/auth-state.sql";

export class AuthSessionDbRepository implements AuthSessionRepository {
  async create(input: {
    id: string;
    userId: string;
    expiresAt: Date;
  }): Promise<void> {
    const now = new Date();
    await db.insert(authSessions).values({
      id: input.id,
      userId: input.userId,
      expiresAt: input.expiresAt,
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
}
