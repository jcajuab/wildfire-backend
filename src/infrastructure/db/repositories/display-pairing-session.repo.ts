import { and, eq, gt } from "drizzle-orm";
import {
  type DisplayPairingSessionRecord,
  type DisplayPairingSessionRepository,
} from "#/application/ports/display-auth";
import { db } from "#/infrastructure/db/client";
import { displayPairingSessions } from "#/infrastructure/db/schema/display-pairing-session.sql";

const toRecord = (
  row: typeof displayPairingSessions.$inferSelect,
): DisplayPairingSessionRecord => ({
  id: row.id,
  pairingCodeId: row.pairingCodeId,
  state:
    row.state === "completed" ||
    row.state === "aborted" ||
    row.state === "expired"
      ? row.state
      : "open",
  challengeNonce: row.challengeNonce,
  challengeExpiresAt:
    row.challengeExpiresAt instanceof Date
      ? row.challengeExpiresAt.toISOString()
      : row.challengeExpiresAt,
  completedAt:
    row.completedAt instanceof Date
      ? row.completedAt.toISOString()
      : (row.completedAt ?? null),
  createdAt:
    row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  updatedAt:
    row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
});

export class DisplayPairingSessionDbRepository
  implements DisplayPairingSessionRepository
{
  async create(input: {
    pairingCodeId: string;
    challengeNonce: string;
    challengeExpiresAt: Date;
  }): Promise<DisplayPairingSessionRecord> {
    const id = crypto.randomUUID();
    const now = new Date();
    await db.insert(displayPairingSessions).values({
      id,
      pairingCodeId: input.pairingCodeId,
      state: "open",
      challengeNonce: input.challengeNonce,
      challengeExpiresAt: input.challengeExpiresAt,
      createdAt: now,
      updatedAt: now,
    });
    const rows = await db
      .select()
      .from(displayPairingSessions)
      .where(eq(displayPairingSessions.id, id))
      .limit(1);
    const created = rows[0];
    if (!created) {
      throw new Error("Failed to load created display pairing session");
    }
    return toRecord(created);
  }

  async findOpenById(input: {
    id: string;
    now: Date;
  }): Promise<DisplayPairingSessionRecord | null> {
    const rows = await db
      .select()
      .from(displayPairingSessions)
      .where(
        and(
          eq(displayPairingSessions.id, input.id),
          eq(displayPairingSessions.state, "open"),
          gt(displayPairingSessions.challengeExpiresAt, input.now),
        ),
      )
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async complete(id: string, completedAt: Date): Promise<void> {
    await db
      .update(displayPairingSessions)
      .set({ state: "completed", completedAt, updatedAt: completedAt })
      .where(eq(displayPairingSessions.id, id));
  }
}
