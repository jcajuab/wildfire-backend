import { eq } from "drizzle-orm";
import { type CredentialsRepository } from "#/application/ports/auth";
import { db } from "#/infrastructure/db/client";
import { passwordHashes } from "#/infrastructure/db/schema/password-hashes.sql";
import { users } from "#/infrastructure/db/schema/rbac.sql";

const normalizeUsername = (value: string): string => value.trim().toLowerCase();

export class DbCredentialsRepository implements CredentialsRepository {
  async findPasswordHash(username: string): Promise<string | null> {
    const normalized = normalizeUsername(username);
    const rows = await db
      .select({ passwordHash: passwordHashes.passwordHash })
      .from(passwordHashes)
      .innerJoin(users, eq(users.id, passwordHashes.userId))
      .where(eq(users.username, normalized))
      .limit(1);

    return rows[0]?.passwordHash ?? null;
  }

  async updatePasswordHash(
    username: string,
    newPasswordHash: string,
  ): Promise<void> {
    const normalized = normalizeUsername(username);
    const user = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, normalized))
      .limit(1);

    if (!user[0]) {
      throw new Error(`User not found: ${normalized}`);
    }

    const result = await db
      .update(passwordHashes)
      .set({ passwordHash: newPasswordHash, updatedAt: new Date() })
      .where(eq(passwordHashes.userId, user[0].id));

    if (result[0].affectedRows === 0) {
      throw new Error(`No password hash entry for user: ${normalized}`);
    }
  }

  async createPasswordHash(
    username: string,
    passwordHash: string,
  ): Promise<void> {
    const normalized = normalizeUsername(username);
    const user = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, normalized))
      .limit(1);

    if (!user[0]) {
      throw new Error(`User not found: ${normalized}`);
    }

    await db.insert(passwordHashes).values({
      userId: user[0].id,
      passwordHash,
    });
  }

  async hasPasswordHash(userId: string): Promise<boolean> {
    const rows = await db
      .select({ userId: passwordHashes.userId })
      .from(passwordHashes)
      .where(eq(passwordHashes.userId, userId))
      .limit(1);

    return rows.length > 0;
  }

  async listUserIdsWithPasswordHash(): Promise<string[]> {
    const rows = await db
      .select({ userId: passwordHashes.userId })
      .from(passwordHashes);

    return rows.map((row) => row.userId);
  }
}
