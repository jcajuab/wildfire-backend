import { and, eq, gt, isNull } from "drizzle-orm";
import { type AuthSessionRepository } from "#/application/ports/auth";
import { db } from "#/infrastructure/db/client";
import { authSessions } from "#/infrastructure/db/schema/auth-session.sql";

export class AuthSessionDbRepository implements AuthSessionRepository {
  async create(input: {
    id: string;
    userId: string;
    expiresAt: Date;
  }): Promise<void> {
    await db.insert(authSessions).values({
      id: input.id,
      userId: input.userId,
      expiresAt: input.expiresAt,
    });
  }

  async revokeById(sessionId: string): Promise<void> {
    await db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(authSessions.id, sessionId));
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(authSessions.userId, userId));
  }

  async isActive(sessionId: string, now: Date): Promise<boolean> {
    const rows = await db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(
        and(
          eq(authSessions.id, sessionId),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, now),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
