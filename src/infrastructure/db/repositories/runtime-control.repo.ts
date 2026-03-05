import { eq } from "drizzle-orm";
import {
  type RuntimeControlRecord,
  type RuntimeControlRepository,
} from "#/application/ports/runtime-controls";
import { db } from "#/infrastructure/db/client";
import { runtimeControl } from "#/infrastructure/db/schema/runtime-control.sql";

const GLOBAL_ID = "global" as const;

const toRecord = (
  row: typeof runtimeControl.$inferSelect,
): RuntimeControlRecord => ({
  id: GLOBAL_ID,
  globalEmergencyActive: row.globalEmergencyActive,
  globalEmergencyStartedAt:
    row.globalEmergencyStartedAt instanceof Date
      ? row.globalEmergencyStartedAt.toISOString()
      : (row.globalEmergencyStartedAt ?? null),
  createdAt:
    row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  updatedAt:
    row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
});

export class RuntimeControlDbRepository implements RuntimeControlRepository {
  async getGlobal(): Promise<RuntimeControlRecord> {
    const rows = await db
      .select()
      .from(runtimeControl)
      .where(eq(runtimeControl.id, GLOBAL_ID))
      .limit(1);

    const existing = rows[0];
    if (existing) {
      return toRecord(existing);
    }

    const now = new Date();
    await db.insert(runtimeControl).values({
      id: GLOBAL_ID,
      globalEmergencyActive: false,
      globalEmergencyStartedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id: GLOBAL_ID,
      globalEmergencyActive: false,
      globalEmergencyStartedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async setGlobalEmergencyState(input: {
    active: boolean;
    startedAt: Date | null;
    at: Date;
  }): Promise<RuntimeControlRecord> {
    await this.getGlobal();

    await db
      .update(runtimeControl)
      .set({
        globalEmergencyActive: input.active,
        globalEmergencyStartedAt: input.startedAt,
        updatedAt: input.at,
      })
      .where(eq(runtimeControl.id, GLOBAL_ID));

    return this.getGlobal();
  }
}
