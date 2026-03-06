import { desc, eq, sql } from "drizzle-orm";
import { ValidationError } from "#/application/errors/validation";
import {
  type ScheduleRecord,
  type ScheduleRepository,
} from "#/application/ports/schedules";
import { db } from "#/infrastructure/db/client";
import { schedules } from "#/infrastructure/db/schema/schedule.sql";

const parseScheduleKind = (value: string): ScheduleRecord["kind"] => {
  if (value === "PLAYLIST" || value === "FLASH") {
    return value;
  }
  throw new ValidationError(`Invalid schedule kind: ${value}`);
};

const toRecord = (row: typeof schedules.$inferSelect): ScheduleRecord => ({
  id: row.id,
  name: row.name,
  kind: parseScheduleKind(row.kind),
  playlistId: row.playlistId,
  contentId: row.contentId,
  displayId: row.displayId,
  startDate: row.startDate,
  endDate: row.endDate,
  startTime: row.startTime,
  endTime: row.endTime,
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

  async listByDisplay(displayId: string): Promise<ScheduleRecord[]> {
    const rows = await db
      .select()
      .from(schedules)
      .where(eq(schedules.displayId, displayId))
      .orderBy(desc(schedules.priority));
    return rows.map(toRecord);
  }

  async listByPlaylistId(playlistId: string): Promise<ScheduleRecord[]> {
    const rows = await db
      .select()
      .from(schedules)
      .where(eq(schedules.playlistId, playlistId));
    return rows.map(toRecord);
  }

  async listByContentId(contentId: string): Promise<ScheduleRecord[]> {
    const rows = await db
      .select()
      .from(schedules)
      .where(eq(schedules.contentId, contentId));
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
    kind?: ScheduleRecord["kind"];
    playlistId: string | null;
    contentId?: string | null;
    displayId: string;
    startDate?: string;
    endDate?: string;
    startTime: string;
    endTime: string;
    priority: number;
    isActive: boolean;
  }): Promise<ScheduleRecord> {
    const id = crypto.randomUUID();
    const now = new Date();
    await db.insert(schedules).values({
      id,
      name: input.name,
      kind: input.kind ?? "PLAYLIST",
      playlistId: input.playlistId,
      contentId: input.contentId ?? null,
      displayId: input.displayId,
      startDate: input.startDate ?? "1970-01-01",
      endDate: input.endDate ?? "2099-12-31",
      startTime: input.startTime,
      endTime: input.endTime,
      priority: input.priority,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      ...input,
      kind: input.kind ?? "PLAYLIST",
      contentId: input.contentId ?? null,
      startDate: input.startDate ?? "1970-01-01",
      endDate: input.endDate ?? "2099-12-31",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async update(
    id: string,
    input: {
      name?: string;
      kind?: ScheduleRecord["kind"];
      playlistId?: string | null;
      contentId?: string | null;
      displayId?: string;
      startDate?: string;
      endDate?: string;
      startTime?: string;
      endTime?: string;
      priority?: number;
      isActive?: boolean;
    },
  ): Promise<ScheduleRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const next = {
      name: input.name ?? existing.name,
      kind: input.kind ?? existing.kind,
      playlistId:
        input.playlistId === undefined ? existing.playlistId : input.playlistId,
      contentId:
        input.contentId === undefined ? existing.contentId : input.contentId,
      displayId: input.displayId ?? existing.displayId,
      startDate: input.startDate ?? existing.startDate,
      endDate: input.endDate ?? existing.endDate,
      startTime: input.startTime ?? existing.startTime,
      endTime: input.endTime ?? existing.endTime,
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

  async countByPlaylistId(playlistId: string): Promise<number> {
    const result = await db
      .select({ value: sql<number>`count(*)` })
      .from(schedules)
      .where(eq(schedules.playlistId, playlistId));
    return result[0]?.value ?? 0;
  }

  async countByContentId(contentId: string): Promise<number> {
    const result = await db
      .select({ value: sql<number>`count(*)` })
      .from(schedules)
      .where(eq(schedules.contentId, contentId));
    return result[0]?.value ?? 0;
  }
}
