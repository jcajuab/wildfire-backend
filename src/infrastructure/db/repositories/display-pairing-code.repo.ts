import { and, eq, gt, isNull } from "drizzle-orm";
import {
  type DisplayPairingCodeRecord,
  type DisplayPairingCodeRepository,
} from "#/application/ports/display-pairing";
import { db } from "#/infrastructure/db/client";
import { pairingCodes } from "#/infrastructure/db/schema/pairing-code.sql";

const toRecord = (
  row: typeof pairingCodes.$inferSelect,
): DisplayPairingCodeRecord => ({
  id: row.id,
  codeHash: row.codeHash,
  expiresAt:
    row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
  usedAt:
    row.usedAt instanceof Date
      ? row.usedAt.toISOString()
      : (row.usedAt ?? null),
  createdById: row.createdById,
  createdAt:
    row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  updatedAt:
    row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
});

export class DisplayPairingCodeDbRepository
  implements DisplayPairingCodeRepository
{
  async create(input: {
    codeHash: string;
    expiresAt: Date;
    createdById: string;
  }): Promise<DisplayPairingCodeRecord> {
    const id = crypto.randomUUID();
    const now = new Date();
    await db.insert(pairingCodes).values({
      id,
      codeHash: input.codeHash,
      expiresAt: input.expiresAt,
      createdById: input.createdById,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      codeHash: input.codeHash,
      expiresAt: input.expiresAt.toISOString(),
      usedAt: null,
      createdById: input.createdById,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async consumeValidCode(input: {
    codeHash: string;
    now: Date;
  }): Promise<DisplayPairingCodeRecord | null> {
    const rows = await db
      .select()
      .from(pairingCodes)
      .where(
        and(
          eq(pairingCodes.codeHash, input.codeHash),
          isNull(pairingCodes.usedAt),
          gt(pairingCodes.expiresAt, input.now),
        ),
      )
      .limit(1);
    const found = rows[0];
    if (!found) return null;

    const updatedAt = new Date();
    const result = await db
      .update(pairingCodes)
      .set({
        usedAt: input.now,
        updatedAt,
      })
      .where(
        and(
          eq(pairingCodes.id, found.id),
          isNull(pairingCodes.usedAt),
          gt(pairingCodes.expiresAt, input.now),
        ),
      );
    if (result[0]?.affectedRows === 0) {
      return null;
    }

    return toRecord({
      ...found,
      usedAt: input.now,
      updatedAt,
    });
  }
}
