import { asc, eq } from "drizzle-orm";
import {
  type EmergencySlotRecord,
  type EmergencySlotRepository,
} from "#/application/ports/emergency-slots";
import { db } from "#/infrastructure/db/client";
import { emergencySlots } from "#/infrastructure/db/schema/emergency-slots.sql";

const mapRowToRecord = (
  row: typeof emergencySlots.$inferSelect,
): EmergencySlotRecord => ({
  slotIndex: row.slotIndex,
  label: row.label,
  contentId: row.contentId ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export class EmergencySlotDbRepository implements EmergencySlotRepository {
  async list(): Promise<EmergencySlotRecord[]> {
    const rows = await db
      .select()
      .from(emergencySlots)
      .orderBy(asc(emergencySlots.slotIndex));
    return rows.map(mapRowToRecord);
  }

  async findByIndex(slotIndex: number): Promise<EmergencySlotRecord | null> {
    const rows = await db
      .select()
      .from(emergencySlots)
      .where(eq(emergencySlots.slotIndex, slotIndex))
      .limit(1);
    return rows[0] ? mapRowToRecord(rows[0]) : null;
  }

  async upsert(input: {
    slotIndex: number;
    label: string;
    contentId: string | null;
    at: Date;
  }): Promise<EmergencySlotRecord> {
    await db
      .insert(emergencySlots)
      .values({
        slotIndex: input.slotIndex,
        label: input.label,
        contentId: input.contentId,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .onDuplicateKeyUpdate({
        set: {
          label: input.label,
          contentId: input.contentId,
          updatedAt: input.at,
        },
      });

    const stored = await this.findByIndex(input.slotIndex);
    if (!stored) {
      throw new Error("Failed to upsert emergency slot");
    }
    return stored;
  }

  async delete(slotIndex: number): Promise<boolean> {
    const result = await db
      .delete(emergencySlots)
      .where(eq(emergencySlots.slotIndex, slotIndex));
    return (result[0]?.affectedRows ?? 0) > 0;
  }
}
