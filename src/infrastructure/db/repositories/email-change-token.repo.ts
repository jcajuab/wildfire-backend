import { and, eq, gt, lte } from "drizzle-orm";
import { type EmailChangeTokenRepository } from "#/application/ports/auth";
import { db } from "#/infrastructure/db/client";
import { emailChangeTokens } from "#/infrastructure/db/schema/auth-state.sql";

export class EmailChangeTokenDbRepository
  implements EmailChangeTokenRepository
{
  async store(input: {
    userId: string;
    email: string;
    hashedToken: string;
    expiresAt: Date;
  }): Promise<void> {
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx
        .delete(emailChangeTokens)
        .where(eq(emailChangeTokens.userId, input.userId));

      await tx.insert(emailChangeTokens).values({
        hashedToken: input.hashedToken,
        userId: input.userId,
        email: input.email,
        expiresAt: input.expiresAt,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  async findByHashedToken(
    hashedToken: string,
    now: Date,
  ): Promise<{ userId: string; email: string; expiresAt: Date } | null> {
    const rows = await db
      .select({
        userId: emailChangeTokens.userId,
        email: emailChangeTokens.email,
        expiresAt: emailChangeTokens.expiresAt,
      })
      .from(emailChangeTokens)
      .where(
        and(
          eq(emailChangeTokens.hashedToken, hashedToken),
          gt(emailChangeTokens.expiresAt, now),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      userId: row.userId,
      email: row.email,
      expiresAt: row.expiresAt,
    };
  }

  async findPendingByUserId(
    userId: string,
    now: Date,
  ): Promise<{ email: string; expiresAt: Date } | null> {
    const rows = await db
      .select({
        email: emailChangeTokens.email,
        expiresAt: emailChangeTokens.expiresAt,
      })
      .from(emailChangeTokens)
      .where(
        and(
          eq(emailChangeTokens.userId, userId),
          gt(emailChangeTokens.expiresAt, now),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row
      ? {
          email: row.email,
          expiresAt: row.expiresAt,
        }
      : null;
  }

  async consumeByHashedToken(hashedToken: string): Promise<void> {
    await db
      .delete(emailChangeTokens)
      .where(eq(emailChangeTokens.hashedToken, hashedToken));
  }

  async deleteByUserId(userId: string): Promise<void> {
    await db
      .delete(emailChangeTokens)
      .where(eq(emailChangeTokens.userId, userId));
  }

  async deleteExpired(now: Date): Promise<void> {
    await db
      .delete(emailChangeTokens)
      .where(lte(emailChangeTokens.expiresAt, now));
  }
}
