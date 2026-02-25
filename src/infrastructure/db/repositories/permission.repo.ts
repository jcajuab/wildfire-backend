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
    isRoot?: boolean;
  }): Promise<PermissionRecord> {
    const id = crypto.randomUUID();
    const isRoot = input.isRoot ?? false;
    await db.insert(permissions).values({
      id,
      resource: input.resource,
      action: input.action,
      isRoot,
    });
    return { id, resource: input.resource, action: input.action, isRoot };
  }

  async updateIsRoot(id: string, isRoot: boolean): Promise<void> {
    await db.update(permissions).set({ isRoot }).where(eq(permissions.id, id));
  }
}
