import { eq, inArray } from "drizzle-orm";
import {
  type PermissionRecord,
  type PermissionRepository,
} from "#/application/ports/rbac";
import { db } from "#/infrastructure/db/client";
import { permissions } from "#/infrastructure/db/schema/rbac.sql";

export class PermissionDbRepository implements PermissionRepository {
  async list(): Promise<PermissionRecord[]> {
    return db.select().from(permissions);
  }

  async findByIds(ids: string[]): Promise<PermissionRecord[]> {
    if (ids.length === 0) return [];
    return db.select().from(permissions).where(inArray(permissions.id, ids));
  }

  async create(input: {
    resource: string;
    action: string;
    isAdmin?: boolean;
  }): Promise<PermissionRecord> {
    const id = crypto.randomUUID();
    const isAdmin = input.isAdmin ?? false;
    await db.insert(permissions).values({
      id,
      resource: input.resource,
      action: input.action,
      isAdmin,
    });
    return { id, resource: input.resource, action: input.action, isAdmin };
  }

  async updateIsAdmin(id: string, isAdmin: boolean): Promise<void> {
    await db.update(permissions).set({ isAdmin }).where(eq(permissions.id, id));
  }

  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await db.delete(permissions).where(inArray(permissions.id, ids));
  }
}
