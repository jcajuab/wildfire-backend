import { and, eq, gt, lt } from "drizzle-orm";
import { type PasswordResetTokenRepository } from "#/application/ports/auth";
import { db } from "#/infrastructure/db/client";
import { passwordResetTokens } from "#/infrastructure/db/schema/password-reset-token.sql";

export class PasswordResetTokenDbRepository
  implements PasswordResetTokenRepository
{
  async store(input: {
    hashedToken: string;
    email: string;
    expiresAt: Date;
  }): Promise<void> {
    await db.insert(passwordResetTokens).values({
      hashedToken: input.hashedToken,
      email: input.email,
      expiresAt: input.expiresAt,
    });
  }

  async findByHashedToken(
    hashedToken: string,
    now: Date,
  ): Promise<{ email: string } | null> {
    const rows = await db
      .select({ email: passwordResetTokens.email })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.hashedToken, hashedToken),
          gt(passwordResetTokens.expiresAt, now),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async consumeByHashedToken(hashedToken: string): Promise<void> {
    await db
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.hashedToken, hashedToken));
  }

  async deleteExpired(now: Date): Promise<void> {
    await db
      .delete(passwordResetTokens)
      .where(lt(passwordResetTokens.expiresAt, now));
  }
}
