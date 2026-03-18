import { eq, inArray } from "drizzle-orm";
import {
  type DisplayGroupRecord,
  type DisplayGroupRepository,
} from "#/application/ports/displays";
import { db } from "#/infrastructure/db/client";
import {
  displayGroupMembers,
  displayGroups,
} from "#/infrastructure/db/schema/displays.sql";
import { toIsoString } from "./utils/date";

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
        createdAt: toIsoString(row.createdAt),
        updatedAt: toIsoString(row.updatedAt),
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
