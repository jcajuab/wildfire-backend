import { eq, inArray } from "drizzle-orm";
import {
  type DeviceGroupRecord,
  type DeviceGroupRepository,
} from "#/application/ports/devices";
import { db } from "#/infrastructure/db/client";
import {
  deviceGroupMemberships,
  deviceGroups,
} from "#/infrastructure/db/schema/device.sql";

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : value;

const mapRowsToGroups = (
  rows: Array<{
    id: string;
    name: string;
    createdAt: Date | string;
    updatedAt: Date | string;
    deviceId: string | null;
  }>,
): DeviceGroupRecord[] => {
  const byId = new Map<string, DeviceGroupRecord>();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (!existing) {
      byId.set(row.id, {
        id: row.id,
        name: row.name,
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
        deviceIds: row.deviceId ? [row.deviceId] : [],
      });
      continue;
    }
    if (row.deviceId) existing.deviceIds.push(row.deviceId);
  }
  return [...byId.values()];
};

export class DeviceGroupDbRepository implements DeviceGroupRepository {
  async list(): Promise<DeviceGroupRecord[]> {
    const rows = await db
      .select({
        id: deviceGroups.id,
        name: deviceGroups.name,
        createdAt: deviceGroups.createdAt,
        updatedAt: deviceGroups.updatedAt,
        deviceId: deviceGroupMemberships.deviceId,
      })
      .from(deviceGroups)
      .leftJoin(
        deviceGroupMemberships,
        eq(deviceGroupMemberships.groupId, deviceGroups.id),
      );
    return mapRowsToGroups(rows);
  }

  async findById(id: string): Promise<DeviceGroupRecord | null> {
    const rows = await db
      .select({
        id: deviceGroups.id,
        name: deviceGroups.name,
        createdAt: deviceGroups.createdAt,
        updatedAt: deviceGroups.updatedAt,
        deviceId: deviceGroupMemberships.deviceId,
      })
      .from(deviceGroups)
      .leftJoin(
        deviceGroupMemberships,
        eq(deviceGroupMemberships.groupId, deviceGroups.id),
      )
      .where(eq(deviceGroups.id, id));
    const mapped = mapRowsToGroups(rows);
    return mapped[0] ?? null;
  }

  async findByName(name: string): Promise<DeviceGroupRecord | null> {
    const rows = await db
      .select({
        id: deviceGroups.id,
        name: deviceGroups.name,
        createdAt: deviceGroups.createdAt,
        updatedAt: deviceGroups.updatedAt,
        deviceId: deviceGroupMemberships.deviceId,
      })
      .from(deviceGroups)
      .leftJoin(
        deviceGroupMemberships,
        eq(deviceGroupMemberships.groupId, deviceGroups.id),
      )
      .where(eq(deviceGroups.name, name));
    const mapped = mapRowsToGroups(rows);
    return mapped[0] ?? null;
  }

  async create(input: { name: string }): Promise<DeviceGroupRecord> {
    const id = crypto.randomUUID();
    const now = new Date();
    await db.insert(deviceGroups).values({
      id,
      name: input.name,
      createdAt: now,
      updatedAt: now,
    });
    return {
      id,
      name: input.name,
      deviceIds: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async update(
    id: string,
    input: { name?: string },
  ): Promise<DeviceGroupRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    const nextName = input.name ?? existing.name;
    const now = new Date();
    await db
      .update(deviceGroups)
      .set({ name: nextName, updatedAt: now })
      .where(eq(deviceGroups.id, id));
    return {
      ...existing,
      name: nextName,
      updatedAt: now.toISOString(),
    };
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(deviceGroups).where(eq(deviceGroups.id, id));
    return result[0].affectedRows > 0;
  }

  async setDeviceGroups(deviceId: string, groupIds: string[]): Promise<void> {
    await db
      .delete(deviceGroupMemberships)
      .where(eq(deviceGroupMemberships.deviceId, deviceId));
    if (groupIds.length === 0) return;
    await db.insert(deviceGroupMemberships).values(
      groupIds.map((groupId) => ({
        groupId,
        deviceId,
      })),
    );
    await db
      .update(deviceGroups)
      .set({ updatedAt: new Date() })
      .where(inArray(deviceGroups.id, groupIds));
  }
}
