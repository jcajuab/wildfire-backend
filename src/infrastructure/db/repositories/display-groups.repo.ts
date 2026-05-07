import { and, asc, eq, inArray, like, sql } from "drizzle-orm";
import {
  type DisplayGroupRecord,
  type DisplayGroupRepository,
} from "#/application/ports/displays";
import { db } from "#/infrastructure/db/client";
import {
  displayGroupMembers,
  displayGroups,
} from "#/infrastructure/db/schema/displays.sql";
import { buildLikeContainsPattern } from "#/infrastructure/db/utils/sql";

const mapRowsToGroupRecords = (
  rows: Array<{
    id: string;
    name: string;
    createdAt: Date | string;
    updatedAt: Date | string;
    displayId: string | null;
  }>,
): DisplayGroupRecord[] => {
  const byId = new Map<string, DisplayGroupRecord>();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (!existing) {
      byId.set(row.id, {
        id: row.id,
        name: row.name,
        createdAt:
          row.createdAt instanceof Date
            ? row.createdAt.toISOString()
            : row.createdAt,
        updatedAt:
          row.updatedAt instanceof Date
            ? row.updatedAt.toISOString()
            : row.updatedAt,
        displayIds: row.displayId ? [row.displayId] : [],
      });
      continue;
    }
    if (row.displayId) existing.displayIds.push(row.displayId);
  }
  return [...byId.values()];
};

const buildDisplayGroupQuery = () =>
  db
    .select({
      id: displayGroups.id,
      name: displayGroups.name,
      createdAt: displayGroups.createdAt,
      updatedAt: displayGroups.updatedAt,
      displayId: displayGroupMembers.displayId,
    })
    .from(displayGroups)
    .leftJoin(
      displayGroupMembers,
      eq(displayGroupMembers.groupId, displayGroups.id),
    );

export class DisplayGroupDbRepository implements DisplayGroupRepository {
  async list(): Promise<DisplayGroupRecord[]> {
    const rows = await buildDisplayGroupQuery();
    return mapRowsToGroupRecords(rows);
  }

  async listPage(input: {
    offset: number;
    limit: number;
    q?: string;
    displayId?: string;
    membership?: "member" | "non-member";
  }): Promise<{ items: DisplayGroupRecord[]; total: number }> {
    const normalizedQuery = input.q?.trim();
    const conditions = [
      normalizedQuery
        ? like(displayGroups.name, buildLikeContainsPattern(normalizedQuery))
        : undefined,
    ].filter((value) => value !== undefined);

    if (input.displayId) {
      const membership = input.membership ?? "member";
      const memberSubquery = sql`SELECT 1 FROM ${displayGroupMembers} WHERE ${displayGroupMembers.groupId} = ${displayGroups.id} AND ${displayGroupMembers.displayId} = ${input.displayId}`;
      conditions.push(
        membership === "member"
          ? sql`EXISTS (${memberSubquery})`
          : sql`NOT EXISTS (${memberSubquery})`,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [pageRows, totalRows] = await Promise.all([
      db
        .select({
          id: displayGroups.id,
          name: displayGroups.name,
          createdAt: displayGroups.createdAt,
          updatedAt: displayGroups.updatedAt,
        })
        .from(displayGroups)
        .where(whereClause)
        .orderBy(asc(displayGroups.name))
        .limit(input.limit)
        .offset(input.offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(displayGroups)
        .where(whereClause),
    ]);

    const pageGroupIds = pageRows.map((row) => row.id);
    const memberRows =
      pageGroupIds.length > 0
        ? await db
            .select({
              groupId: displayGroupMembers.groupId,
              displayId: displayGroupMembers.displayId,
            })
            .from(displayGroupMembers)
            .where(inArray(displayGroupMembers.groupId, pageGroupIds))
        : [];

    const membersByGroupId = new Map<string, string[]>();
    for (const row of memberRows) {
      const list = membersByGroupId.get(row.groupId) ?? [];
      list.push(row.displayId);
      membersByGroupId.set(row.groupId, list);
    }

    const items: DisplayGroupRecord[] = pageRows.map((row) => ({
      id: row.id,
      name: row.name,
      displayIds: membersByGroupId.get(row.id) ?? [],
      createdAt:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : row.createdAt,
      updatedAt:
        row.updatedAt instanceof Date
          ? row.updatedAt.toISOString()
          : row.updatedAt,
    }));

    return {
      items,
      total: Number(totalRows[0]?.count ?? 0),
    };
  }

  async findById(id: string): Promise<DisplayGroupRecord | null> {
    const rows = await buildDisplayGroupQuery().where(eq(displayGroups.id, id));
    const mapped = mapRowsToGroupRecords(rows);
    return mapped[0] ?? null;
  }

  async findByName(name: string): Promise<DisplayGroupRecord | null> {
    const rows = await buildDisplayGroupQuery().where(
      eq(displayGroups.name, name),
    );
    const mapped = mapRowsToGroupRecords(rows);
    return mapped[0] ?? null;
  }

  async create(input: { name: string }): Promise<DisplayGroupRecord> {
    const id = crypto.randomUUID();
    const now = new Date();
    await db.insert(displayGroups).values({
      id,
      name: input.name,
      createdAt: now,
      updatedAt: now,
    });
    return {
      id,
      name: input.name,
      displayIds: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async update(
    id: string,
    input: { name?: string },
  ): Promise<DisplayGroupRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    const nextName = input.name ?? existing.name;
    const now = new Date();
    await db
      .update(displayGroups)
      .set({ name: nextName, updatedAt: now })
      .where(eq(displayGroups.id, id));
    return {
      ...existing,
      name: nextName,
      updatedAt: now.toISOString(),
    };
  }

  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(displayGroups)
      .where(eq(displayGroups.id, id));
    return (result[0]?.affectedRows ?? 0) > 0;
  }

  async setDisplayGroups(displayId: string, groupIds: string[]): Promise<void> {
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .delete(displayGroupMembers)
        .where(eq(displayGroupMembers.displayId, displayId));
      if (groupIds.length > 0) {
        await tx
          .insert(displayGroupMembers)
          .values(groupIds.map((groupId) => ({ groupId, displayId })));
        await tx
          .update(displayGroups)
          .set({ updatedAt: now })
          .where(inArray(displayGroups.id, groupIds));
      }
    });
  }
}
