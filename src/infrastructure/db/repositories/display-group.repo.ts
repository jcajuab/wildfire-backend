import { eq, inArray } from "drizzle-orm";
import {
  type DisplayGroupRecord,
  type DisplayGroupRepository,
} from "#/application/ports/displays";
import { db } from "#/infrastructure/db/client";
import {
  displayGroupMemberships,
  displayGroups,
} from "#/infrastructure/db/schema/display.sql";

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : value;

const mapRowsToGroups = (
  rows: Array<{
    id: string;
    name: string;
    colorIndex: number;
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
        colorIndex: row.colorIndex,
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
        displayIds: row.displayId ? [row.displayId] : [],
      });
      continue;
    }
    if (row.displayId) existing.displayIds.push(row.displayId);
  }
  return [...byId.values()];
};

export class DisplayGroupDbRepository implements DisplayGroupRepository {
  async list(): Promise<DisplayGroupRecord[]> {
    const rows = await db
      .select({
        id: displayGroups.id,
        name: displayGroups.name,
        colorIndex: displayGroups.colorIndex,
        createdAt: displayGroups.createdAt,
        updatedAt: displayGroups.updatedAt,
        displayId: displayGroupMemberships.displayId,
      })
      .from(displayGroups)
      .leftJoin(
        displayGroupMemberships,
        eq(displayGroupMemberships.groupId, displayGroups.id),
      );
    return mapRowsToGroups(rows);
  }

  async findById(id: string): Promise<DisplayGroupRecord | null> {
    const rows = await db
      .select({
        id: displayGroups.id,
        name: displayGroups.name,
        colorIndex: displayGroups.colorIndex,
        createdAt: displayGroups.createdAt,
        updatedAt: displayGroups.updatedAt,
        displayId: displayGroupMemberships.displayId,
      })
      .from(displayGroups)
      .leftJoin(
        displayGroupMemberships,
        eq(displayGroupMemberships.groupId, displayGroups.id),
      )
      .where(eq(displayGroups.id, id));
    const mapped = mapRowsToGroups(rows);
    return mapped[0] ?? null;
  }

  async findByName(name: string): Promise<DisplayGroupRecord | null> {
    const rows = await db
      .select({
        id: displayGroups.id,
        name: displayGroups.name,
        colorIndex: displayGroups.colorIndex,
        createdAt: displayGroups.createdAt,
        updatedAt: displayGroups.updatedAt,
        displayId: displayGroupMemberships.displayId,
      })
      .from(displayGroups)
      .leftJoin(
        displayGroupMemberships,
        eq(displayGroupMemberships.groupId, displayGroups.id),
      )
      .where(eq(displayGroups.name, name));
    const mapped = mapRowsToGroups(rows);
    return mapped[0] ?? null;
  }

  async create(input: {
    name: string;
    colorIndex: number;
  }): Promise<DisplayGroupRecord> {
    const id = crypto.randomUUID();
    const now = new Date();
    await db.insert(displayGroups).values({
      id,
      name: input.name,
      colorIndex: input.colorIndex,
      createdAt: now,
      updatedAt: now,
    });
    return {
      id,
      name: input.name,
      colorIndex: input.colorIndex,
      displayIds: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async update(
    id: string,
    input: { name?: string; colorIndex?: number },
  ): Promise<DisplayGroupRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    const nextName = input.name ?? existing.name;
    const nextColorIndex = input.colorIndex ?? existing.colorIndex;
    const now = new Date();
    await db
      .update(displayGroups)
      .set({ name: nextName, colorIndex: nextColorIndex, updatedAt: now })
      .where(eq(displayGroups.id, id));
    return {
      ...existing,
      name: nextName,
      colorIndex: nextColorIndex,
      updatedAt: now.toISOString(),
    };
  }

  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(displayGroups)
      .where(eq(displayGroups.id, id));
    return result[0].affectedRows > 0;
  }

  async setDisplayGroups(displayId: string, groupIds: string[]): Promise<void> {
    await db
      .delete(displayGroupMemberships)
      .where(eq(displayGroupMemberships.displayId, displayId));
    if (groupIds.length === 0) return;
    await db.insert(displayGroupMemberships).values(
      groupIds.map((groupId) => ({
        groupId,
        displayId,
      })),
    );
    await db
      .update(displayGroups)
      .set({ updatedAt: new Date() })
      .where(inArray(displayGroups.id, groupIds));
  }
}
