import { and, eq } from "drizzle-orm";
import {
  type DisplayKeyRecord,
  type DisplayKeyRepository,
} from "#/application/ports/display-auth";
import { db } from "#/infrastructure/db/client";
import {
  displayActiveKeys,
  displayKeyPairs,
} from "#/infrastructure/db/schema/display-key.sql";
import { toIsoString, toNullableIsoString } from "./utils/date";

type DisplayKeyRow = {
  id: string;
  displayId: string;
  algorithm: "ed25519";
  publicKey: string;
  revokedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  activeDisplayId: string | null;
};

const mapDisplayKeyRowToRecord = (row: DisplayKeyRow): DisplayKeyRecord => ({
  id: row.id,
  displayId: row.displayId,
  algorithm: row.algorithm,
  publicKey: row.publicKey,
  status:
    row.activeDisplayId != null && row.revokedAt == null ? "active" : "revoked",
  revokedAt: toNullableIsoString(row.revokedAt),
  createdAt: toIsoString(row.createdAt),
  updatedAt: toIsoString(row.updatedAt),
});

const buildDisplayKeyQuery = () =>
  db
    .select({
      id: displayKeyPairs.id,
      displayId: displayKeyPairs.displayId,
      algorithm: displayKeyPairs.algorithm,
      publicKey: displayKeyPairs.publicKey,
      revokedAt: displayKeyPairs.revokedAt,
      createdAt: displayKeyPairs.createdAt,
      updatedAt: displayKeyPairs.updatedAt,
      activeDisplayId: displayActiveKeys.displayId,
    })
    .from(displayKeyPairs)
    .leftJoin(
      displayActiveKeys,
      eq(displayActiveKeys.keyPairId, displayKeyPairs.id),
    );

export class DisplayKeyDbRepository implements DisplayKeyRepository {
  async create(input: {
    displayId: string;
    algorithm: "ed25519";
    publicKey: string;
  }): Promise<DisplayKeyRecord> {
    const now = new Date();
    const newId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      const currentActiveRows = await tx
        .select({ keyPairId: displayActiveKeys.keyPairId })
        .from(displayActiveKeys)
        .where(eq(displayActiveKeys.displayId, input.displayId))
        .limit(1);
      const currentActiveKeyPairId = currentActiveRows[0]?.keyPairId ?? null;

      await tx.insert(displayKeyPairs).values({
        id: newId,
        displayId: input.displayId,
        algorithm: input.algorithm,
        publicKey: input.publicKey,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      await tx
        .insert(displayActiveKeys)
        .values({
          displayId: input.displayId,
          keyPairId: newId,
          activatedAt: now,
          updatedAt: now,
        })
        .onDuplicateKeyUpdate({
          set: {
            keyPairId: newId,
            activatedAt: now,
            updatedAt: now,
          },
        });

      if (currentActiveKeyPairId && currentActiveKeyPairId !== newId) {
        await tx
          .update(displayKeyPairs)
          .set({
            revokedAt: now,
            updatedAt: now,
          })
          .where(eq(displayKeyPairs.id, currentActiveKeyPairId));
      }
    });

    const created = await this.findActiveByKeyId(newId);
    if (!created) {
      throw new Error("Failed to load created display key");
    }

    return created;
  }

  async findActiveByKeyId(keyId: string): Promise<DisplayKeyRecord | null> {
    const rows = await buildDisplayKeyQuery()
      .where(
        and(
          eq(displayKeyPairs.id, keyId),
          eq(displayActiveKeys.keyPairId, keyId),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row ? mapDisplayKeyRowToRecord(row) : null;
  }

  async findActiveByDisplayId(
    displayId: string,
  ): Promise<DisplayKeyRecord | null> {
    const rows = await buildDisplayKeyQuery()
      .where(eq(displayActiveKeys.displayId, displayId))
      .limit(1);

    const row = rows[0];
    return row ? mapDisplayKeyRowToRecord(row) : null;
  }

  async revokeByDisplayId(displayId: string, at: Date): Promise<void> {
    const activeRows = await db
      .select({ keyPairId: displayActiveKeys.keyPairId })
      .from(displayActiveKeys)
      .where(eq(displayActiveKeys.displayId, displayId))
      .limit(1);

    const activeKeyPairId = activeRows[0]?.keyPairId;
    if (!activeKeyPairId) {
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(displayKeyPairs)
        .set({
          revokedAt: at,
          updatedAt: at,
        })
        .where(eq(displayKeyPairs.id, activeKeyPairId));

      await tx
        .delete(displayActiveKeys)
        .where(eq(displayActiveKeys.displayId, displayId));
    });
  }
}
