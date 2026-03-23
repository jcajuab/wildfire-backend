import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import {
  type DisplayRecord,
  type DisplayRepository,
  type DisplayStatus,
} from "#/application/ports/displays";
import { db } from "#/infrastructure/db/client";
import {
  displayGroupMembers,
  displayRuntimeStates,
  displays,
} from "#/infrastructure/db/schema/displays.sql";
import { buildLikeContainsPattern } from "#/infrastructure/db/utils/sql";
import { toIsoString, toNullableIsoString } from "./utils/date";

const parseDisplayStatus = (
  value: string | null | undefined,
): DisplayStatus => {
  if (
    value === "PROCESSING" ||
    value === "READY" ||
    value === "LIVE" ||
    value === "DOWN"
  ) {
    return value;
  }
  throw new Error(`Invalid display status: ${String(value)}`);
};

type DisplayRow = {
  id: string;
  slug: string;
  name: string;
  fingerprint: string | null;
  output: string;
  location: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  runtimeStatus: string | null;
  runtimeIpAddress: string | null;
  runtimeMacAddress: string | null;
  runtimeScreenWidth: number | null;
  runtimeScreenHeight: number | null;
  runtimeOrientation: "LANDSCAPE" | "PORTRAIT" | null;
  runtimeLastSeenAt: Date | string | null;
  runtimeRefreshNonce: number | null;
  emergencyContentId: string | null;
};

const mapDisplayRowToRecord = (row: DisplayRow): DisplayRecord => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  fingerprint: row.fingerprint,
  status: parseDisplayStatus(row.runtimeStatus),
  location: row.location,
  ipAddress: row.runtimeIpAddress,
  macAddress: row.runtimeMacAddress,
  screenWidth: row.runtimeScreenWidth,
  screenHeight: row.runtimeScreenHeight,
  output: row.output,
  orientation: row.runtimeOrientation,
  emergencyContentId: row.emergencyContentId,
  lastSeenAt: toNullableIsoString(row.runtimeLastSeenAt),
  refreshNonce: row.runtimeRefreshNonce ?? 0,
  createdAt: toIsoString(row.createdAt),
  updatedAt: toIsoString(row.updatedAt),
});

const buildDisplayQuery = () =>
  db
    .select({
      id: displays.id,
      slug: displays.slug,
      name: displays.name,
      fingerprint: displays.fingerprint,
      output: displays.output,
      location: displays.location,
      createdAt: displays.createdAt,
      updatedAt: displays.updatedAt,
      runtimeStatus: displayRuntimeStates.status,
      runtimeIpAddress: displayRuntimeStates.ipAddress,
      runtimeMacAddress: displayRuntimeStates.macAddress,
      runtimeScreenWidth: displayRuntimeStates.screenWidth,
      runtimeScreenHeight: displayRuntimeStates.screenHeight,
      runtimeOrientation: displayRuntimeStates.orientation,
      runtimeLastSeenAt: displayRuntimeStates.lastSeenAt,
      runtimeRefreshNonce: displayRuntimeStates.refreshNonce,
      emergencyContentId: displays.emergencyContentId,
    })
    .from(displays)
    .leftJoin(
      displayRuntimeStates,
      eq(displayRuntimeStates.displayId, displays.id),
    );

export class DisplayDbRepository implements DisplayRepository {
  async list(): Promise<DisplayRecord[]> {
    const rows = await buildDisplayQuery().orderBy(desc(displays.createdAt));
    return rows.map(mapDisplayRowToRecord);
  }

  async listForReconciliation(): Promise<DisplayRecord[]> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const rows = await buildDisplayQuery()
      .where(
        or(
          sql`${displayRuntimeStates.lastSeenAt} > ${fiveMinutesAgo}`,
          sql`${displayRuntimeStates.status} != 'DOWN'`,
        ),
      )
      .orderBy(desc(displays.createdAt));
    return rows.map(mapDisplayRowToRecord);
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
      buildDisplayQuery()
        .orderBy(desc(displays.createdAt))
        .limit(pageSize)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(displays),
    ]);

    return {
      items: rows.map(mapDisplayRowToRecord),
      total: Number(totalRows[0]?.count ?? 0),
      page,
      pageSize,
    };
  }

  async searchPage(input: {
    page: number;
    pageSize: number;
    q?: string;
    status?: DisplayStatus;
    output?: string;
    groupIds?: readonly string[];
    sortBy?: "name" | "status" | "location";
    sortDirection?: "asc" | "desc";
  }): Promise<{
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

    let filteredDisplayIds: string[] | undefined;
    if (input.groupIds && input.groupIds.length > 0) {
      const rows = await db
        .select({ displayId: displayGroupMembers.displayId })
        .from(displayGroupMembers)
        .where(inArray(displayGroupMembers.groupId, [...input.groupIds]));
      filteredDisplayIds = [...new Set(rows.map((row) => row.displayId))];
      if (filteredDisplayIds.length === 0) {
        return { items: [], total: 0, page, pageSize };
      }
    }

    const normalizedQuery = input.q?.trim();
    const normalizedOutput = input.output?.trim();
    const conditions = [
      input.status ? eq(displayRuntimeStates.status, input.status) : undefined,
      normalizedOutput ? eq(displays.output, normalizedOutput) : undefined,
      filteredDisplayIds ? inArray(displays.id, filteredDisplayIds) : undefined,
      normalizedQuery
        ? or(
            like(displays.name, buildLikeContainsPattern(normalizedQuery)),
            like(displays.slug, buildLikeContainsPattern(normalizedQuery)),
            like(displays.location, buildLikeContainsPattern(normalizedQuery)),
            like(displays.output, buildLikeContainsPattern(normalizedQuery)),
          )
        : undefined,
    ].filter((value) => value !== undefined);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const primaryOrder =
      input.sortBy === "status"
        ? input.sortDirection === "desc"
          ? desc(displayRuntimeStates.status)
          : asc(displayRuntimeStates.status)
        : input.sortBy === "location"
          ? input.sortDirection === "desc"
            ? desc(displays.location)
            : asc(displays.location)
          : input.sortDirection === "desc"
            ? desc(displays.name)
            : asc(displays.name);
    const secondaryOrder =
      input.sortBy === "name"
        ? desc(displays.createdAt)
        : input.sortDirection === "desc"
          ? desc(displays.name)
          : asc(displays.name);

    const [rows, totalRows] = await Promise.all([
      buildDisplayQuery()
        .where(whereClause)
        .orderBy(primaryOrder, secondaryOrder)
        .limit(pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(displays)
        .leftJoin(
          displayRuntimeStates,
          eq(displayRuntimeStates.displayId, displays.id),
        )
        .where(whereClause),
    ]);

    return {
      items: rows.map(mapDisplayRowToRecord),
      total: Number(totalRows[0]?.count ?? 0),
      page,
      pageSize,
    };
  }

  async findByIds(ids: string[]): Promise<DisplayRecord[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await buildDisplayQuery().where(inArray(displays.id, ids));
    return rows.map(mapDisplayRowToRecord);
  }

  async findById(id: string): Promise<DisplayRecord | null> {
    const rows = await buildDisplayQuery().where(eq(displays.id, id)).limit(1);
    return rows[0] ? mapDisplayRowToRecord(rows[0]) : null;
  }

  async findBySlug(slug: string): Promise<DisplayRecord | null> {
    const rows = await buildDisplayQuery()
      .where(eq(displays.slug, slug))
      .limit(1);
    return rows[0] ? mapDisplayRowToRecord(rows[0]) : null;
  }

  async findByFingerprint(fingerprint: string): Promise<DisplayRecord | null> {
    const rows = await buildDisplayQuery()
      .where(eq(displays.fingerprint, fingerprint))
      .limit(1);
    return rows[0] ? mapDisplayRowToRecord(rows[0]) : null;
  }

  async findByFingerprintAndOutput(
    fingerprint: string,
    output: string,
  ): Promise<DisplayRecord | null> {
    const rows = await buildDisplayQuery()
      .where(
        and(eq(displays.fingerprint, fingerprint), eq(displays.output, output)),
      )
      .limit(1);
    return rows[0] ? mapDisplayRowToRecord(rows[0]) : null;
  }

  async create(input: {
    name: string;
    slug: string;
    fingerprint?: string | null;
    location: string | null;
  }): Promise<DisplayRecord> {
    const id = crypto.randomUUID();
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx.insert(displays).values({
        id,
        slug: input.slug,
        name: input.name,
        fingerprint: input.fingerprint ?? null,
        output: "unknown",
        location: input.location,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(displayRuntimeStates).values({
        displayId: id,
        status: "PROCESSING",
        refreshNonce: 0,
        createdAt: now,
        updatedAt: now,
      });
    });

    const created = await this.findById(id);
    if (!created) {
      throw new Error("Failed to load newly created display");
    }

    return created;
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

    await db.transaction(async (tx) => {
      await tx.insert(displays).values({
        id,
        slug: input.slug,
        name: input.name,
        fingerprint: input.fingerprint,
        output: input.output,
        location: input.location ?? null,
        createdAt: input.now,
        updatedAt: input.now,
      });

      await tx.insert(displayRuntimeStates).values({
        displayId: id,
        status: "PROCESSING",
        ipAddress: input.ipAddress ?? null,
        macAddress: input.macAddress ?? null,
        screenWidth: input.screenWidth,
        screenHeight: input.screenHeight,
        orientation: input.orientation ?? null,
        refreshNonce: 0,
        createdAt: input.now,
        updatedAt: input.now,
      });
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
    },
  ): Promise<DisplayRecord | null> {
    const existing = await this.findById(id);
    if (!existing) {
      return null;
    }

    const now = new Date();

    const nextName = input.name ?? existing.name;
    const nextSlug = input.slug ?? existing.slug;
    const nextFingerprint =
      input.fingerprint !== undefined
        ? input.fingerprint
        : (existing.fingerprint ?? null);
    const nextOutput =
      input.output !== undefined
        ? (input.output ?? "unknown")
        : (existing.output ?? "unknown");
    const nextLocation =
      input.location !== undefined ? input.location : existing.location;
    const nextEmergencyContentId =
      input.emergencyContentId !== undefined
        ? input.emergencyContentId
        : (existing.emergencyContentId ?? null);

    const runtimePatch = {
      ipAddress:
        input.ipAddress !== undefined
          ? input.ipAddress
          : (existing.ipAddress ?? null),
      macAddress:
        input.macAddress !== undefined
          ? input.macAddress
          : (existing.macAddress ?? null),
      screenWidth:
        input.screenWidth !== undefined
          ? input.screenWidth
          : (existing.screenWidth ?? null),
      screenHeight:
        input.screenHeight !== undefined
          ? input.screenHeight
          : (existing.screenHeight ?? null),
      orientation:
        input.orientation !== undefined
          ? input.orientation
          : (existing.orientation ?? null),
      updatedAt: now,
    };

    await db.transaction(async (tx) => {
      await tx
        .update(displays)
        .set({
          name: nextName,
          slug: nextSlug,
          fingerprint: nextFingerprint,
          output: nextOutput,
          location: nextLocation,
          emergencyContentId: nextEmergencyContentId,
          updatedAt: now,
        })
        .where(eq(displays.id, id));

      await tx
        .insert(displayRuntimeStates)
        .values({
          displayId: id,
          status: existing.status,
          ipAddress: runtimePatch.ipAddress,
          macAddress: runtimePatch.macAddress,
          screenWidth: runtimePatch.screenWidth,
          screenHeight: runtimePatch.screenHeight,
          orientation: runtimePatch.orientation,
          lastSeenAt: existing.lastSeenAt
            ? new Date(existing.lastSeenAt)
            : null,
          refreshNonce: existing.refreshNonce ?? 0,
          createdAt: now,
          updatedAt: now,
        })
        .onDuplicateKeyUpdate({
          set: runtimePatch,
        });
    });

    return {
      ...existing,
      name: nextName,
      slug: nextSlug,
      fingerprint: nextFingerprint,
      status: existing.status,
      location: nextLocation,
      ipAddress: runtimePatch.ipAddress,
      macAddress: runtimePatch.macAddress,
      screenWidth: runtimePatch.screenWidth,
      screenHeight: runtimePatch.screenHeight,
      output: nextOutput,
      orientation: runtimePatch.orientation,
      emergencyContentId: nextEmergencyContentId,
      lastSeenAt: existing.lastSeenAt ?? null,
      refreshNonce: existing.refreshNonce ?? 0,
      updatedAt: now.toISOString(),
    };
  }

  async setStatus(input: {
    id: string;
    status: DisplayStatus;
    at: Date;
  }): Promise<void> {
    await db
      .update(displayRuntimeStates)
      .set({
        status: input.status,
        updatedAt: input.at,
      })
      .where(eq(displayRuntimeStates.displayId, input.id));
  }

  async bumpRefreshNonce(id: string): Promise<boolean> {
    const now = new Date();
    const result = await db
      .update(displayRuntimeStates)
      .set({
        refreshNonce: sql`${displayRuntimeStates.refreshNonce} + 1`,
        updatedAt: now,
      })
      .where(eq(displayRuntimeStates.displayId, id));

    return (result[0]?.affectedRows ?? 0) > 0;
  }

  async touchSeen(id: string, at: Date): Promise<void> {
    await db
      .update(displayRuntimeStates)
      .set({ lastSeenAt: at, updatedAt: at })
      .where(eq(displayRuntimeStates.displayId, id));
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(displays).where(eq(displays.id, id));
    return (result[0]?.affectedRows ?? 0) > 0;
  }
}
