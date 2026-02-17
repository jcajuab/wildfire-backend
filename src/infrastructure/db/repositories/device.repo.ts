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
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async update(
    id: string,
    input: { name?: string; location?: string | null },
  ): Promise<DeviceRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const next = {
      name: input.name ?? existing.name,
      location:
        input.location !== undefined ? input.location : existing.location,
    };

    const now = new Date();
    await db
      .update(devices)
      .set({
        name: next.name,
        location: next.location,
        updatedAt: now,
      })
      .where(eq(devices.id, id));

    return {
      ...existing,
      ...next,
      updatedAt: now.toISOString(),
    };
  }
}
