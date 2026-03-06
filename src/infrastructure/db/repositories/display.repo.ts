import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  type DisplayRecord,
  type DisplayRepository,
  type DisplayStatus,
} from "#/application/ports/displays";
import { db } from "#/infrastructure/db/client";
import {
  displayEmergencyStates,
  displayRuntimeStates,
  displays,
} from "#/infrastructure/db/schema/displays.sql";

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
  return "PROCESSING";
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
  localEmergencyActive: boolean | null;
  localEmergencyStartedAt: Date | string | null;
};

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : value;

const toNullableIso = (value: Date | string | null): string | null => {
  if (value == null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
};

const toRecord = (row: DisplayRow): DisplayRecord => ({
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
  localEmergencyActive: row.localEmergencyActive ?? false,
  localEmergencyStartedAt: toNullableIso(row.localEmergencyStartedAt),
  lastSeenAt: toNullableIso(row.runtimeLastSeenAt),
  refreshNonce: row.runtimeRefreshNonce ?? 0,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const withJoins = () =>
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
      emergencyContentId: displayEmergencyStates.emergencyContentId,
      localEmergencyActive: displayEmergencyStates.localEmergencyActive,
      localEmergencyStartedAt: displayEmergencyStates.localEmergencyStartedAt,
    })
    .from(displays)
    .leftJoin(
      displayRuntimeStates,
      eq(displayRuntimeStates.displayId, displays.id),
    )
    .leftJoin(
      displayEmergencyStates,
      eq(displayEmergencyStates.displayId, displays.id),
    );

const ensureRuntimeState = async (displayId: string, at: Date) => {
  await db
    .insert(displayRuntimeStates)
    .values({
      displayId,
      status: "PROCESSING",
      createdAt: at,
      updatedAt: at,
    })
    .onDuplicateKeyUpdate({
      set: {
        updatedAt: at,
      },
    });
};

export class DisplayDbRepository implements DisplayRepository {
  async list(): Promise<DisplayRecord[]> {
    const rows = await withJoins().orderBy(desc(displays.createdAt));
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
      withJoins()
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

    const rows = await withJoins().where(inArray(displays.id, ids));
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<DisplayRecord | null> {
    const rows = await withJoins().where(eq(displays.id, id)).limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findBySlug(slug: string): Promise<DisplayRecord | null> {
    const rows = await withJoins().where(eq(displays.slug, slug)).limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findByFingerprint(fingerprint: string): Promise<DisplayRecord | null> {
    const rows = await withJoins()
      .where(eq(displays.fingerprint, fingerprint))
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findByFingerprintAndOutput(
    fingerprint: string,
    output: string,
  ): Promise<DisplayRecord | null> {
    const rows = await withJoins()
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

      await tx.insert(displayEmergencyStates).values({
        displayId: id,
        localEmergencyActive: false,
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

      await tx.insert(displayEmergencyStates).values({
        displayId: id,
        localEmergencyActive: false,
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
      localEmergencyActive?: boolean;
      localEmergencyStartedAt?: string | null;
    },
  ): Promise<DisplayRecord | null> {
    const existing = await this.findById(id);
    if (!existing) {
      return null;
    }

    const now = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(displays)
        .set({
          name: input.name ?? existing.name,
          slug: input.slug ?? existing.slug,
          fingerprint:
            input.fingerprint !== undefined
              ? input.fingerprint
              : (existing.fingerprint ?? null),
          output:
            input.output !== undefined
              ? (input.output ?? "unknown")
              : (existing.output ?? "unknown"),
          location:
            input.location !== undefined ? input.location : existing.location,
          updatedAt: now,
        })
        .where(eq(displays.id, id));

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

      const emergencyPatch = {
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
            ? input.localEmergencyStartedAt != null
              ? new Date(input.localEmergencyStartedAt)
              : null
            : existing.localEmergencyStartedAt
              ? new Date(existing.localEmergencyStartedAt)
              : null,
        updatedAt: now,
      };

      await tx
        .insert(displayEmergencyStates)
        .values({
          displayId: id,
          emergencyContentId: emergencyPatch.emergencyContentId,
          localEmergencyActive: emergencyPatch.localEmergencyActive,
          localEmergencyStartedAt: emergencyPatch.localEmergencyStartedAt,
          createdAt: now,
          updatedAt: now,
        })
        .onDuplicateKeyUpdate({
          set: emergencyPatch,
        });
    });

    return this.findById(id);
  }

  async setStatus(input: {
    id: string;
    status: DisplayStatus;
    at: Date;
  }): Promise<void> {
    await ensureRuntimeState(input.id, input.at);
    await db
      .update(displayRuntimeStates)
      .set({
        status: input.status,
        updatedAt: input.at,
      })
      .where(eq(displayRuntimeStates.displayId, input.id));
  }

  async bumpRefreshNonce(id: string): Promise<boolean> {
    const existing = await this.findById(id);
    if (!existing) {
      return false;
    }

    const now = new Date();
    await ensureRuntimeState(id, now);
    await db
      .update(displayRuntimeStates)
      .set({
        refreshNonce: sql`${displayRuntimeStates.refreshNonce} + 1`,
        updatedAt: now,
      })
      .where(eq(displayRuntimeStates.displayId, id));

    return true;
  }

  async touchSeen(id: string, at: Date): Promise<void> {
    await ensureRuntimeState(id, at);
    await db
      .update(displayRuntimeStates)
      .set({ lastSeenAt: at, updatedAt: at })
      .where(eq(displayRuntimeStates.displayId, id));
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(displays).where(eq(displays.id, id));
    return result[0]?.affectedRows > 0;
  }
}
