import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  type DisplayRecord,
  type DisplayRepository,
  type DisplayStatus,
} from "#/application/ports/displays";
import { db } from "#/infrastructure/db/client";
import { displays } from "#/infrastructure/db/schema/displays.sql";

const parseDisplayStatus = (value: string): DisplayStatus => {
  if (
    value === "PROCESSING" ||
    value === "READY" ||
    value === "LIVE" ||
    value === "DOWN"
  ) {
    return value;
  }
  throw new Error(`Unexpected display status: ${value}`);
};

const toRecord = (row: typeof displays.$inferSelect): DisplayRecord => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  fingerprint: row.fingerprint ?? null,
  status: parseDisplayStatus(row.status),
  location: row.location ?? null,
  ipAddress: row.ipAddress ?? null,
  macAddress: row.macAddress ?? null,
  screenWidth: row.screenWidth ?? null,
  screenHeight: row.screenHeight ?? null,
  output: row.output ?? null,
  orientation:
    row.orientation === "LANDSCAPE" || row.orientation === "PORTRAIT"
      ? row.orientation
      : null,
  emergencyContentId: row.emergencyContentId ?? null,
  localEmergencyActive: row.localEmergencyActive,
  localEmergencyStartedAt:
    row.localEmergencyStartedAt instanceof Date
      ? row.localEmergencyStartedAt.toISOString()
      : (row.localEmergencyStartedAt ?? null),
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

  async listPage(input: { page: number; pageSize: number }): Promise<{
    items: DisplayRecord[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Number.isInteger(input.page) ? Math.max(1, input.page) : 1;
    const pageSize = Number.isInteger(input.pageSize)
      ? Math.min(100, Math.max(1, input.pageSize))
      : 20;
    const offset = (page - 1) * pageSize;

    const [rows, totalRows] = await Promise.all([
      db
        .select()
        .from(displays)
        .orderBy(desc(displays.createdAt))
        .limit(pageSize)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(displays),
    ]);

    return {
      items: rows.map(toRecord),
      total: Number(totalRows[0]?.count ?? 0),
      page,
      pageSize,
    };
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

  async findBySlug(slug: string): Promise<DisplayRecord | null> {
    const rows = await db
      .select()
      .from(displays)
      .where(eq(displays.slug, slug))
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findByFingerprint(fingerprint: string): Promise<DisplayRecord | null> {
    const rows = await db
      .select()
      .from(displays)
      .where(eq(displays.fingerprint, fingerprint))
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findByFingerprintAndOutput(
    fingerprint: string,
    output: string,
  ): Promise<DisplayRecord | null> {
    const rows = await db
      .select()
      .from(displays)
      .where(
        and(eq(displays.fingerprint, fingerprint), eq(displays.output, output)),
      )
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async create(input: {
    name: string;
    slug: string;
    fingerprint?: string | null;
    location: string | null;
  }): Promise<DisplayRecord> {
    const id = crypto.randomUUID();
    const now = new Date();
    await db.insert(displays).values({
      id,
      slug: input.slug,
      name: input.name,
      fingerprint: input.fingerprint ?? null,
      status: "PROCESSING",
      location: input.location,
      output: "unknown",
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      slug: input.slug,
      name: input.name,
      fingerprint: input.fingerprint ?? null,
      status: "PROCESSING",
      location: input.location,
      ipAddress: null,
      macAddress: null,
      screenWidth: null,
      screenHeight: null,
      output: "unknown",
      orientation: null,
      emergencyContentId: null,
      localEmergencyActive: false,
      localEmergencyStartedAt: null,
      lastSeenAt: null,
      refreshNonce: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async createRegisteredDisplay(input: {
    slug: string;
    name: string;
    fingerprint: string;
    output: string;
    screenWidth: number;
    screenHeight: number;
    orientation?: "LANDSCAPE" | "PORTRAIT" | null;
    ipAddress?: string | null;
    macAddress?: string | null;
    location?: string | null;
    now: Date;
  }): Promise<DisplayRecord> {
    const id = crypto.randomUUID();
    await db.insert(displays).values({
      id,
      slug: input.slug,
      name: input.name,
      fingerprint: input.fingerprint,
      status: "PROCESSING",
      location: input.location ?? null,
      ipAddress: input.ipAddress ?? null,
      macAddress: input.macAddress ?? null,
      screenWidth: input.screenWidth,
      screenHeight: input.screenHeight,
      output: input.output,
      orientation: input.orientation ?? null,
      emergencyContentId: null,
      localEmergencyActive: false,
      localEmergencyStartedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    });

    const created = await this.findById(id);
    if (!created) {
      throw new Error("Failed to load newly registered display");
    }
    return created;
  }

  async update(
    id: string,
    input: {
      name?: string;
      slug?: string;
      fingerprint?: string | null;
      location?: string | null;
      ipAddress?: string | null;
      macAddress?: string | null;
      screenWidth?: number | null;
      screenHeight?: number | null;
      output?: string | null;
      orientation?: "LANDSCAPE" | "PORTRAIT" | null;
      emergencyContentId?: string | null;
      localEmergencyActive?: boolean;
      localEmergencyStartedAt?: string | null;
    },
  ): Promise<DisplayRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const next = {
      name: input.name ?? existing.name,
      slug: input.slug ?? existing.slug,
      fingerprint:
        input.fingerprint !== undefined
          ? input.fingerprint
          : (existing.fingerprint ?? null),
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
      output:
        input.output !== undefined
          ? (input.output ?? "unknown")
          : (existing.output ?? "unknown"),
      orientation:
        input.orientation !== undefined
          ? input.orientation
          : existing.orientation,
      emergencyContentId:
        input.emergencyContentId !== undefined
          ? input.emergencyContentId
          : (existing.emergencyContentId ?? null),
      localEmergencyActive:
        input.localEmergencyActive !== undefined
          ? input.localEmergencyActive
          : (existing.localEmergencyActive ?? false),
      localEmergencyStartedAt:
        input.localEmergencyStartedAt !== undefined
          ? input.localEmergencyStartedAt
          : (existing.localEmergencyStartedAt ?? null),
    };

    const now = new Date();
    await db
      .update(displays)
      .set({
        name: next.name,
        slug: next.slug,
        fingerprint: next.fingerprint,
        location: next.location,
        ipAddress: next.ipAddress,
        macAddress: next.macAddress,
        screenWidth: next.screenWidth,
        screenHeight: next.screenHeight,
        output: next.output,
        orientation: next.orientation,
        emergencyContentId: next.emergencyContentId,
        localEmergencyActive: next.localEmergencyActive,
        localEmergencyStartedAt:
          next.localEmergencyStartedAt != null
            ? new Date(next.localEmergencyStartedAt)
            : null,
        updatedAt: now,
      })
      .where(eq(displays.id, id));

    return {
      ...existing,
      ...next,
      updatedAt: now.toISOString(),
    };
  }

  async setStatus(input: {
    id: string;
    status: DisplayStatus;
    at: Date;
  }): Promise<void> {
    await db
      .update(displays)
      .set({
        status: input.status,
        updatedAt: input.at,
      })
      .where(eq(displays.id, input.id));
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

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(displays).where(eq(displays.id, id));
    return (result[0]?.affectedRows ?? 0) > 0;
  }
}
