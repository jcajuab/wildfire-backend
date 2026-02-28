import { and, eq } from "drizzle-orm";
import {
  type DisplayKeyRecord,
  type DisplayKeyRepository,
} from "#/application/ports/display-auth";
import { db } from "#/infrastructure/db/client";
import { displayKeys } from "#/infrastructure/db/schema/display-key.sql";

const toRecord = (row: typeof displayKeys.$inferSelect): DisplayKeyRecord => ({
  id: row.id,
  displayId: row.displayId,
  algorithm: row.algorithm === "ed25519" ? "ed25519" : "ed25519",
  publicKey: row.publicKey,
  status: row.status === "revoked" ? "revoked" : "active",
  revokedAt:
    row.revokedAt instanceof Date
      ? row.revokedAt.toISOString()
      : (row.revokedAt ?? null),
  createdAt:
    row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  updatedAt:
    row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
});

export class DisplayKeyDbRepository implements DisplayKeyRepository {
  async create(input: {
    displayId: string;
    algorithm: "ed25519";
    publicKey: string;
  }): Promise<DisplayKeyRecord> {
    const id = crypto.randomUUID();
    const now = new Date();
    await db.insert(displayKeys).values({
      id,
      displayId: input.displayId,
      algorithm: input.algorithm,
      publicKey: input.publicKey,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const row = await db
      .select()
      .from(displayKeys)
      .where(eq(displayKeys.id, id))
      .limit(1);
    const created = row[0];
    if (!created) {
      throw new Error("Failed to load created display key");
    }
    return toRecord(created);
  }

  async findActiveByKeyId(keyId: string): Promise<DisplayKeyRecord | null> {
    const rows = await db
      .select()
      .from(displayKeys)
      .where(and(eq(displayKeys.id, keyId), eq(displayKeys.status, "active")))
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findActiveByDisplayId(
    displayId: string,
  ): Promise<DisplayKeyRecord | null> {
    const rows = await db
      .select()
      .from(displayKeys)
      .where(
        and(
          eq(displayKeys.displayId, displayId),
          eq(displayKeys.status, "active"),
        ),
      )
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async revokeByDisplayId(displayId: string, at: Date): Promise<void> {
    await db
      .update(displayKeys)
      .set({ status: "revoked", revokedAt: at, updatedAt: at })
      .where(eq(displayKeys.displayId, displayId));
  }
}
