import { desc, eq, sql } from "drizzle-orm";
import { ValidationError } from "#/application/errors/validation";
import {
  type ScheduleKind,
  type ScheduleRecord,
  type ScheduleRepository,
} from "#/application/ports/schedules";
import { db } from "#/infrastructure/db/client";
import {
  scheduleContentTargets,
  schedulePlaylistTargets,
  schedules,
} from "#/infrastructure/db/schema/schedule.sql";

type ScheduleRow = {
  id: string;
  name: string;
  displayId: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  priority: number;
  isActive: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
  playlistId: string | null;
  contentId: string | null;
};

const resolveKind = (row: ScheduleRow): ScheduleKind => {
  if (row.playlistId != null && row.contentId == null) {
    return "PLAYLIST";
  }
  if (row.contentId != null && row.playlistId == null) {
    return "FLASH";
  }
  throw new ValidationError(
    `Invalid schedule target for schedule ${row.id}: expected exactly one target`,
  );
};

const toRecord = (row: ScheduleRow): ScheduleRecord => ({
  id: row.id,
  name: row.name,
  kind: resolveKind(row),
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

const withTargets = () =>
  db
    .select({
      id: schedules.id,
      name: schedules.name,
      displayId: schedules.displayId,
      startDate: schedules.startDate,
      endDate: schedules.endDate,
      startTime: schedules.startTime,
      endTime: schedules.endTime,
      priority: schedules.priority,
      isActive: schedules.isActive,
      createdAt: schedules.createdAt,
      updatedAt: schedules.updatedAt,
      playlistId: schedulePlaylistTargets.playlistId,
      contentId: scheduleContentTargets.contentId,
    })
    .from(schedules)
    .leftJoin(
      schedulePlaylistTargets,
      eq(schedulePlaylistTargets.scheduleId, schedules.id),
    )
    .leftJoin(
      scheduleContentTargets,
      eq(scheduleContentTargets.scheduleId, schedules.id),
    );

const assertValidTarget = (input: {
  kind: ScheduleKind;
  playlistId: string | null;
  contentId: string | null;
}) => {
  if (input.kind === "PLAYLIST") {
    if (input.playlistId == null || input.contentId != null) {
      throw new ValidationError("Playlist schedules require playlistId only");
    }
    return;
  }

  if (input.contentId == null || input.playlistId != null) {
    throw new ValidationError("Flash schedules require contentId only");
  }
};

export class ScheduleDbRepository implements ScheduleRepository {
  async list(): Promise<ScheduleRecord[]> {
    const rows = await withTargets().orderBy(desc(schedules.createdAt));
    return rows.map(toRecord);
  }

  async listByDisplay(displayId: string): Promise<ScheduleRecord[]> {
    const rows = await withTargets()
      .where(eq(schedules.displayId, displayId))
      .orderBy(desc(schedules.priority));
    return rows.map(toRecord);
  }

  async listByPlaylistId(playlistId: string): Promise<ScheduleRecord[]> {
    const rows = await withTargets().where(
      eq(schedulePlaylistTargets.playlistId, playlistId),
    );
    return rows.map(toRecord);
  }

  async listByContentId(contentId: string): Promise<ScheduleRecord[]> {
    const rows = await withTargets().where(
      eq(scheduleContentTargets.contentId, contentId),
    );
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<ScheduleRecord | null> {
    const rows = await withTargets().where(eq(schedules.id, id)).limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async create(input: {
    name: string;
    kind?: ScheduleKind;
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
    const kind = input.kind ?? "PLAYLIST";
    const contentId = input.contentId ?? null;

    assertValidTarget({
      kind,
      playlistId: input.playlistId,
      contentId,
    });

    await db.transaction(async (tx) => {
      await tx.insert(schedules).values({
        id,
        name: input.name,
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

      if (kind === "PLAYLIST") {
        await tx.insert(schedulePlaylistTargets).values({
          scheduleId: id,
          playlistId: input.playlistId as string,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await tx.insert(scheduleContentTargets).values({
          scheduleId: id,
          contentId: contentId as string,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    const created = await this.findById(id);
    if (!created) {
      throw new Error("Failed to load created schedule");
    }
    return created;
  }

  async update(
    id: string,
    input: {
      name?: string;
      kind?: ScheduleKind;
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
    if (!existing) {
      return null;
    }

    const now = new Date();
    const nextKind = input.kind ?? existing.kind ?? "PLAYLIST";
    const nextPlaylistId =
      input.playlistId === undefined ? existing.playlistId : input.playlistId;
    const nextContentId =
      input.contentId === undefined
        ? (existing.contentId ?? null)
        : input.contentId;

    assertValidTarget({
      kind: nextKind,
      playlistId: nextPlaylistId,
      contentId: nextContentId,
    });

    await db.transaction(async (tx) => {
      await tx
        .update(schedules)
        .set({
          name: input.name ?? existing.name,
          displayId: input.displayId ?? existing.displayId,
          startDate: input.startDate ?? existing.startDate,
          endDate: input.endDate ?? existing.endDate,
          startTime: input.startTime ?? existing.startTime,
          endTime: input.endTime ?? existing.endTime,
          priority: input.priority ?? existing.priority,
          isActive: input.isActive ?? existing.isActive,
          updatedAt: now,
        })
        .where(eq(schedules.id, id));

      await tx
        .delete(schedulePlaylistTargets)
        .where(eq(schedulePlaylistTargets.scheduleId, id));
      await tx
        .delete(scheduleContentTargets)
        .where(eq(scheduleContentTargets.scheduleId, id));

      if (nextKind === "PLAYLIST") {
        await tx.insert(schedulePlaylistTargets).values({
          scheduleId: id,
          playlistId: nextPlaylistId as string,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await tx.insert(scheduleContentTargets).values({
          scheduleId: id,
          contentId: nextContentId as string,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(schedules).where(eq(schedules.id, id));
    return result[0]?.affectedRows > 0;
  }

  async countByPlaylistId(playlistId: string): Promise<number> {
    const result = await db
      .select({ value: sql<number>`count(*)` })
      .from(schedulePlaylistTargets)
      .where(eq(schedulePlaylistTargets.playlistId, playlistId));
    return result[0]?.value ?? 0;
  }

  async countByContentId(contentId: string): Promise<number> {
    const result = await db
      .select({ value: sql<number>`count(*)` })
      .from(scheduleContentTargets)
      .where(eq(scheduleContentTargets.contentId, contentId));
    return result[0]?.value ?? 0;
  }
}
