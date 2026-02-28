import { and, desc, eq, inArray } from "drizzle-orm";
import { type DisplayRegistrationState } from "#/application/ports/display-auth";
import {
  type DisplayRecord,
  type DisplayRepository,
} from "#/application/ports/displays";
import { db } from "#/infrastructure/db/client";
import { displays } from "#/infrastructure/db/schema/display.sql";

const toRecord = (row: typeof displays.$inferSelect): DisplayRecord => ({
  id: row.id,
  displaySlug: row.displaySlug,
  name: row.name,
  identifier: row.displaySlug,
  displayFingerprint: row.displayFingerprint ?? null,
  registrationState:
    row.registrationState === "unpaired" ||
    row.registrationState === "pairing_in_progress" ||
    row.registrationState === "registered" ||
    row.registrationState === "active" ||
    row.registrationState === "unregistered"
      ? row.registrationState
      : "unpaired",
  location: row.location ?? null,
  ipAddress: row.ipAddress ?? null,
  macAddress: row.macAddress ?? null,
  screenWidth: row.screenWidth ?? null,
  screenHeight: row.screenHeight ?? null,
  outputType: row.displayOutput ?? null,
  displayOutput: row.displayOutput ?? null,
  orientation:
    row.orientation === "LANDSCAPE" || row.orientation === "PORTRAIT"
      ? row.orientation
      : null,
  lastSeenAt:
    row.lastSeenAt instanceof Date
      ? row.lastSeenAt.toISOString()
      : (row.lastSeenAt ?? null),
  refreshNonce: row.refreshNonce,
  registeredAt:
    row.registeredAt instanceof Date
      ? row.registeredAt.toISOString()
      : (row.registeredAt ?? null),
  activatedAt:
    row.activatedAt instanceof Date
      ? row.activatedAt.toISOString()
      : (row.activatedAt ?? null),
  unregisteredAt:
    row.unregisteredAt instanceof Date
      ? row.unregisteredAt.toISOString()
      : (row.unregisteredAt ?? null),
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
    return this.findBySlug(identifier);
  }

  async findBySlug(displaySlug: string): Promise<DisplayRecord | null> {
    const rows = await db
      .select()
      .from(displays)
      .where(eq(displays.displaySlug, displaySlug))
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

  async findByFingerprintAndOutput(
    fingerprint: string,
    displayOutput: string,
  ): Promise<DisplayRecord | null> {
    const rows = await db
      .select()
      .from(displays)
      .where(
        and(
          eq(displays.displayFingerprint, fingerprint),
          eq(displays.displayOutput, displayOutput),
        ),
      )
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
      displaySlug: input.identifier,
      name: input.name,
      displayFingerprint: input.displayFingerprint ?? null,
      registrationState: "unpaired",
      location: input.location,
      displayOutput: "unknown",
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      displaySlug: input.identifier,
      identifier: input.identifier,
      name: input.name,
      displayFingerprint: input.displayFingerprint ?? null,
      registrationState: "unpaired",
      location: input.location,
      ipAddress: null,
      macAddress: null,
      screenWidth: null,
      screenHeight: null,
      outputType: "unknown",
      displayOutput: "unknown",
      orientation: null,
      lastSeenAt: null,
      refreshNonce: 0,
      registeredAt: null,
      activatedAt: null,
      unregisteredAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async createRegisteredDisplay(input: {
    displaySlug: string;
    name: string;
    displayFingerprint: string;
    displayOutput: string;
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
      displaySlug: input.displaySlug,
      name: input.name,
      displayFingerprint: input.displayFingerprint,
      registrationState: "registered",
      location: input.location ?? null,
      ipAddress: input.ipAddress ?? null,
      macAddress: input.macAddress ?? null,
      screenWidth: input.screenWidth,
      screenHeight: input.screenHeight,
      displayOutput: input.displayOutput,
      orientation: input.orientation ?? null,
      registeredAt: input.now,
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
      displaySlug: input.identifier ?? existing.displaySlug,
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
      displayOutput:
        input.outputType !== undefined
          ? (input.outputType ?? "unknown")
          : (existing.displayOutput ?? "unknown"),
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
        displaySlug: next.displaySlug,
        displayFingerprint: next.displayFingerprint,
        location: next.location,
        ipAddress: next.ipAddress,
        macAddress: next.macAddress,
        screenWidth: next.screenWidth,
        screenHeight: next.screenHeight,
        displayOutput: next.displayOutput,
        orientation: next.orientation,
        updatedAt: now,
      })
      .where(eq(displays.id, id));

    return {
      ...existing,
      ...next,
      identifier: next.displaySlug,
      outputType: next.displayOutput,
      updatedAt: now.toISOString(),
    };
  }

  async setRegistrationState(input: {
    id: string;
    state: DisplayRegistrationState;
    at: Date;
  }): Promise<void> {
    const patch: {
      registrationState: DisplayRegistrationState;
      updatedAt: Date;
      activatedAt?: Date | null;
      unregisteredAt?: Date | null;
    } = {
      registrationState: input.state,
      updatedAt: input.at,
    };
    if (input.state === "active") {
      patch.activatedAt = input.at;
      patch.unregisteredAt = null;
    }
    if (input.state === "unregistered") {
      patch.unregisteredAt = input.at;
    }
    await db.update(displays).set(patch).where(eq(displays.id, input.id));
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
