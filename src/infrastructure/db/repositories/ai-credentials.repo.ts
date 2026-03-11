import { and, eq } from "drizzle-orm";
import {
  type AICredential,
  type AICredentialsRepository,
} from "#/application/ports/ai";
import { db } from "#/infrastructure/db/client";
import { aiCredentials } from "#/infrastructure/db/schema/ai-credentials.sql";

const toRecord = (row: typeof aiCredentials.$inferSelect): AICredential => ({
  id: row.id,
  userId: row.userId,
  provider: row.provider as AICredential["provider"],
  keyHint: row.keyHint,
  createdAt:
    row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  updatedAt:
    row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
});

export class AICredentialsRepo implements AICredentialsRepository {
  async create(input: {
    userId: string;
    provider: string;
    encryptedKey: string;
    keyHint: string;
    iv: string;
    authTag: string;
  }): Promise<AICredential> {
    const id = crypto.randomUUID();

    // Upsert - delete existing if present then insert
    await db
      .delete(aiCredentials)
      .where(
        and(
          eq(aiCredentials.userId, input.userId),
          eq(aiCredentials.provider, input.provider),
        ),
      );

    await db.insert(aiCredentials).values({
      id,
      userId: input.userId,
      provider: input.provider,
      encryptedKey: input.encryptedKey,
      keyHint: input.keyHint,
      iv: input.iv,
      authTag: input.authTag,
    });

    const row = await db
      .select()
      .from(aiCredentials)
      .where(eq(aiCredentials.id, id))
      .limit(1);

    if (!row[0]) {
      throw new Error("Credential was created but could not be loaded");
    }

    return toRecord(row[0]);
  }

  async findByUserAndProvider(
    userId: string,
    provider: string,
  ): Promise<{ encryptedKey: string; iv: string; authTag: string } | null> {
    const rows = await db
      .select({
        encryptedKey: aiCredentials.encryptedKey,
        iv: aiCredentials.iv,
        authTag: aiCredentials.authTag,
      })
      .from(aiCredentials)
      .where(
        and(
          eq(aiCredentials.userId, userId),
          eq(aiCredentials.provider, provider),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async listForUser(userId: string): Promise<AICredential[]> {
    const rows = await db
      .select()
      .from(aiCredentials)
      .where(eq(aiCredentials.userId, userId));

    return rows.map(toRecord);
  }

  async delete(userId: string, provider: string): Promise<boolean> {
    const result = await db
      .delete(aiCredentials)
      .where(
        and(
          eq(aiCredentials.userId, userId),
          eq(aiCredentials.provider, provider),
        ),
      );

    return (result[0]?.affectedRows ?? 0) > 0;
  }
}
