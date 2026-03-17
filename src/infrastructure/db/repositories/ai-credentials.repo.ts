import { and, eq } from "drizzle-orm";
import {
  type AICredential,
  type AICredentialsRepository,
} from "#/application/ports/ai";
import { db } from "#/infrastructure/db/client";
import { aiCredentials } from "#/infrastructure/db/schema/ai-credentials.sql";
import { toIsoString } from "./utils/date";

const mapAICredentialRowToRecord = (
  row: typeof aiCredentials.$inferSelect,
): AICredential => ({
  id: row.id,
  userId: row.userId,
  provider: row.provider as AICredential["provider"],
  keyHint: row.keyHint,
  createdAt: toIsoString(row.createdAt),
  updatedAt: toIsoString(row.updatedAt),
});

export class AICredentialsDbRepository implements AICredentialsRepository {
  async create(input: {
    userId: string;
    provider: string;
    encryptedKey: string;
    keyHint: string;
    iv: string;
    authTag: string;
  }): Promise<AICredential> {
    const id = crypto.randomUUID();
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx
        .delete(aiCredentials)
        .where(
          and(
            eq(aiCredentials.userId, input.userId),
            eq(aiCredentials.provider, input.provider),
          ),
        );

      await tx.insert(aiCredentials).values({
        id,
        userId: input.userId,
        provider: input.provider,
        encryptedKey: input.encryptedKey,
        keyHint: input.keyHint,
        iv: input.iv,
        authTag: input.authTag,
        createdAt: now,
        updatedAt: now,
      });
    });

    return {
      id,
      userId: input.userId,
      provider: input.provider as AICredential["provider"],
      keyHint: input.keyHint,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
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

    return rows.map(mapAICredentialRowToRecord);
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
