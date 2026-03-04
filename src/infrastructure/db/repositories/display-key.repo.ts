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

const isDuplicateDisplayKeyError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  const dbError = error as {
    code?: string;
    message?: string;
    sqlMessage?: string;
  };
  if (dbError.code !== "ER_DUP_ENTRY") {
    return false;
  }
  const details = [dbError.message, dbError.sqlMessage]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return details.includes("display_keys_display_id_unique");
};

export class DisplayKeyDbRepository implements DisplayKeyRepository {
  async create(input: {
    displayId: string;
    algorithm: "ed25519";
    publicKey: string;
  }): Promise<DisplayKeyRecord> {
    const now = new Date();
    const activateExisting = async (): Promise<DisplayKeyRecord> => {
      const nextId = crypto.randomUUID();
      await db
        .update(displayKeys)
        .set({
          id: nextId,
          algorithm: input.algorithm,
          publicKey: input.publicKey,
          status: "active",
          revokedAt: null,
          updatedAt: now,
        })
        .where(eq(displayKeys.displayId, input.displayId));

      const rows = await db
        .select()
        .from(displayKeys)
        .where(eq(displayKeys.id, nextId))
        .limit(1);
      const activated = rows[0];
      if (!activated) {
        throw new Error("Failed to load activated display key");
      }
      return toRecord(activated);
    };

    try {
      const id = crypto.randomUUID();
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
    } catch (error) {
      if (!isDuplicateDisplayKeyError(error)) {
        throw error;
      }
      return activateExisting();
    }
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
