import { eq } from "drizzle-orm";
import {
  type SystemSettingRecord,
  type SystemSettingRepository,
} from "#/application/ports/settings";
import { db } from "#/infrastructure/db/client";
import { systemSettings } from "#/infrastructure/db/schema/system-setting.sql";

const toRecord = (
  row: typeof systemSettings.$inferSelect,
): SystemSettingRecord => ({
  key: row.key,
  value: row.value,
  createdAt:
    row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  updatedAt:
    row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
});

export class SystemSettingDbRepository implements SystemSettingRepository {
  async findByKey(key: string): Promise<SystemSettingRecord | null> {
    const rows = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, key))
      .limit(1);
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  async upsert(input: {
    key: string;
    value: string;
  }): Promise<SystemSettingRecord> {
    await db
      .insert(systemSettings)
      .values({
        key: input.key,
        value: input.value,
      })
      .onDuplicateKeyUpdate({
        set: {
          value: input.value,
          updatedAt: new Date(),
        },
      });

    const updated = await this.findByKey(input.key);
    if (!updated) {
      throw new Error("Failed to persist system setting");
    }
    return updated;
  }
}
