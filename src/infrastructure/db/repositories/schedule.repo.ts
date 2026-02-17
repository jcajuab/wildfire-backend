import { desc, eq } from "drizzle-orm";
import {
  type ScheduleRecord,
  type ScheduleRepository,
} from "#/application/ports/schedules";
import { db } from "#/infrastructure/db/client";
import { schedules } from "#/infrastructure/db/schema/schedule.sql";

const toRecord = (row: typeof schedules.$inferSelect): ScheduleRecord => ({
  id: row.id,
  name: row.name,
  playlistId: row.playlistId,
  deviceId: row.deviceId,
  startTime: row.startTime,
  endTime: row.endTime,
  daysOfWeek: row.daysOfWeek as number[],
  priority: row.priority,
  isActive: row.isActive,
  createdAt:
    row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  updatedAt:
    row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
});

export class ScheduleDbRepository implements ScheduleRepository {
  async list(): Promise<ScheduleRecord[]> {
    const rows = await db
      .select()
      .from(schedules)
      .orderBy(desc(schedules.createdAt));
    return rows.map(toRecord);
  }

  async listByDevice(deviceId: string): Promise<ScheduleRecord[]> {
    const rows = await db
      .select()
      .from(schedules)
      .where(eq(schedules.deviceId, deviceId))
      .orderBy(desc(schedules.priority));
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<ScheduleRecord | null> {
    const rows = await db
      .select()
      .from(schedules)
      .where(eq(schedules.id, id))
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async create(input: {
    name: string;
    playlistId: string;
    deviceId: string;
    startTime: string;
    endTime: string;
    daysOfWeek: number[];
    priority: number;
    isActive: boolean;
  }): Promise<ScheduleRecord> {
    const id = crypto.randomUUID();
    const now = new Date();
    await db.insert(schedules).values({
      id,
      name: input.name,
      playlistId: input.playlistId,
      deviceId: input.deviceId,
      startTime: input.startTime,
      endTime: input.endTime,
      daysOfWeek: input.daysOfWeek,
      priority: input.priority,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      ...input,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async update(
    id: string,
    input: {
      name?: string;
      playlistId?: string;
      deviceId?: string;
      startTime?: string;
      endTime?: string;
      daysOfWeek?: number[];
      priority?: number;
      isActive?: boolean;
    },
  ): Promise<ScheduleRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const next = {
      name: input.name ?? existing.name,
      playlistId: input.playlistId ?? existing.playlistId,
      deviceId: input.deviceId ?? existing.deviceId,
      startTime: input.startTime ?? existing.startTime,
      endTime: input.endTime ?? existing.endTime,
      daysOfWeek: input.daysOfWeek ?? existing.daysOfWeek,
      priority: input.priority ?? existing.priority,
      isActive: input.isActive ?? existing.isActive,
    };

    const now = new Date();
    await db
      .update(schedules)
      .set({
        ...next,
        updatedAt: now,
      })
      .where(eq(schedules.id, id));

    return {
      ...existing,
      ...next,
      updatedAt: now.toISOString(),
    };
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(schedules).where(eq(schedules.id, id));
    return result[0]?.affectedRows > 0;
  }
}
