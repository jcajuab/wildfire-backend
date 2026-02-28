import { desc, eq, inArray } from "drizzle-orm";
import {
  type DisplayRecord,
  type DisplayRepository,
} from "#/application/ports/displays";
import { db } from "#/infrastructure/db/client";
import { displays } from "#/infrastructure/db/schema/display.sql";

const toRecord = (row: typeof displays.$inferSelect): DisplayRecord => ({
  id: row.id,
  name: row.name,
  identifier: row.identifier,
  displayFingerprint: row.displayFingerprint ?? null,
  location: row.location ?? null,
  ipAddress: row.ipAddress ?? null,
  macAddress: row.macAddress ?? null,
  screenWidth: row.screenWidth ?? null,
  screenHeight: row.screenHeight ?? null,
  outputType: row.outputType ?? null,
  orientation:
    row.orientation === "LANDSCAPE" || row.orientation === "PORTRAIT"
      ? row.orientation
      : null,
  lastSeenAt:
    row.lastSeenAt instanceof Date
      ? row.lastSeenAt.toISOString()
      : (row.lastSeenAt ?? null),
  refreshNonce: row.refreshNonce,
  createdAt:
    row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  updatedAt:
    row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
});

export class DisplayDbRepository implements DisplayRepository {
  async list(): Promise<DisplayRecord[]> {
    const rows = await db
      .select()
      .from(displays)
      .orderBy(desc(displays.createdAt));
    return rows.map(toRecord);
  }

  async findByIds(ids: string[]): Promise<DisplayRecord[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await db
      .select()
      .from(displays)
      .where(inArray(displays.id, ids));
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<DisplayRecord | null> {
    const rows = await db
      .select()
      .from(displays)
      .where(eq(displays.id, id))
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findByIdentifier(identifier: string): Promise<DisplayRecord | null> {
    const rows = await db
      .select()
      .from(displays)
      .where(eq(displays.identifier, identifier))
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findByFingerprint(fingerprint: string): Promise<DisplayRecord | null> {
    const rows = await db
      .select()
      .from(displays)
      .where(eq(displays.displayFingerprint, fingerprint))
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async create(input: {
    name: string;
    identifier: string;
    displayFingerprint?: string | null;
    location: string | null;
  }): Promise<DisplayRecord> {
    const id = crypto.randomUUID();
    const now = new Date();
    await db.insert(displays).values({
      id,
      name: input.name,
      identifier: input.identifier,
      displayFingerprint: input.displayFingerprint ?? null,
      location: input.location,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      name: input.name,
      identifier: input.identifier,
      displayFingerprint: input.displayFingerprint ?? null,
      location: input.location,
      ipAddress: null,
      macAddress: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      lastSeenAt: null,
      refreshNonce: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async update(
    id: string,
    input: {
      name?: string;
      identifier?: string;
      displayFingerprint?: string | null;
      location?: string | null;
      ipAddress?: string | null;
      macAddress?: string | null;
      screenWidth?: number | null;
      screenHeight?: number | null;
      outputType?: string | null;
      orientation?: "LANDSCAPE" | "PORTRAIT" | null;
    },
  ): Promise<DisplayRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const next = {
      name: input.name ?? existing.name,
      identifier: input.identifier ?? existing.identifier,
      displayFingerprint:
        input.displayFingerprint !== undefined
          ? input.displayFingerprint
          : (existing.displayFingerprint ?? null),
      location:
        input.location !== undefined ? input.location : existing.location,
      ipAddress:
        input.ipAddress !== undefined ? input.ipAddress : existing.ipAddress,
      macAddress:
        input.macAddress !== undefined ? input.macAddress : existing.macAddress,
      screenWidth:
        input.screenWidth !== undefined
          ? input.screenWidth
          : existing.screenWidth,
      screenHeight:
        input.screenHeight !== undefined
          ? input.screenHeight
          : existing.screenHeight,
      outputType:
        input.outputType !== undefined ? input.outputType : existing.outputType,
      orientation:
        input.orientation !== undefined
          ? input.orientation
          : existing.orientation,
    };

    const now = new Date();
    await db
      .update(displays)
      .set({
        name: next.name,
        identifier: next.identifier,
        displayFingerprint: next.displayFingerprint,
        location: next.location,
        ipAddress: next.ipAddress,
        macAddress: next.macAddress,
        screenWidth: next.screenWidth,
        screenHeight: next.screenHeight,
        outputType: next.outputType,
        orientation: next.orientation,
        updatedAt: now,
      })
      .where(eq(displays.id, id));

    return {
      ...existing,
      ...next,
      updatedAt: now.toISOString(),
    };
  }

  async bumpRefreshNonce(id: string): Promise<boolean> {
    const existing = await this.findById(id);
    if (!existing) return false;

    await db
      .update(displays)
      .set({
        refreshNonce: (existing.refreshNonce ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(displays.id, id));

    return true;
  }

  async touchSeen(id: string, at: Date): Promise<void> {
    await db
      .update(displays)
      .set({ lastSeenAt: at, updatedAt: at })
      .where(eq(displays.id, id));
  }
}
