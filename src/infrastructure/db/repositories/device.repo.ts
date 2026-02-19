import { desc, eq, inArray } from "drizzle-orm";
import {
  type DeviceRecord,
  type DeviceRepository,
} from "#/application/ports/devices";
import { db } from "#/infrastructure/db/client";
import { devices } from "#/infrastructure/db/schema/device.sql";

const toRecord = (row: typeof devices.$inferSelect): DeviceRecord => ({
  id: row.id,
  name: row.name,
  identifier: row.identifier,
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
  refreshNonce: row.refreshNonce,
  createdAt:
    row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  updatedAt:
    row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
});

export class DeviceDbRepository implements DeviceRepository {
  async list(): Promise<DeviceRecord[]> {
    const rows = await db
      .select()
      .from(devices)
      .orderBy(desc(devices.createdAt));
    return rows.map(toRecord);
  }

  async findByIds(ids: string[]): Promise<DeviceRecord[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await db
      .select()
      .from(devices)
      .where(inArray(devices.id, ids));
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<DeviceRecord | null> {
    const rows = await db
      .select()
      .from(devices)
      .where(eq(devices.id, id))
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findByIdentifier(identifier: string): Promise<DeviceRecord | null> {
    const rows = await db
      .select()
      .from(devices)
      .where(eq(devices.identifier, identifier))
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async create(input: {
    name: string;
    identifier: string;
    location: string | null;
  }): Promise<DeviceRecord> {
    const id = crypto.randomUUID();
    const now = new Date();
    await db.insert(devices).values({
      id,
      name: input.name,
      identifier: input.identifier,
      location: input.location,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      name: input.name,
      identifier: input.identifier,
      location: input.location,
      ipAddress: null,
      macAddress: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      refreshNonce: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async update(
    id: string,
    input: {
      name?: string;
      location?: string | null;
      ipAddress?: string | null;
      macAddress?: string | null;
      screenWidth?: number | null;
      screenHeight?: number | null;
      outputType?: string | null;
      orientation?: "LANDSCAPE" | "PORTRAIT" | null;
    },
  ): Promise<DeviceRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const next = {
      name: input.name ?? existing.name,
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
      .update(devices)
      .set({
        name: next.name,
        location: next.location,
        ipAddress: next.ipAddress,
        macAddress: next.macAddress,
        screenWidth: next.screenWidth,
        screenHeight: next.screenHeight,
        outputType: next.outputType,
        orientation: next.orientation,
        updatedAt: now,
      })
      .where(eq(devices.id, id));

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
      .update(devices)
      .set({
        refreshNonce: (existing.refreshNonce ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(devices.id, id));

    return true;
  }

  async touchSeen(id: string, at: Date): Promise<void> {
    await db.update(devices).set({ updatedAt: at }).where(eq(devices.id, id));
  }
}
