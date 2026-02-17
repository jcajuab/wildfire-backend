import { eq, inArray, sql } from "drizzle-orm";
import { type UserRoleRepository } from "#/application/ports/rbac";
import { db } from "#/infrastructure/db/client";
import { userRoles } from "#/infrastructure/db/schema/rbac.sql";

export class UserRoleDbRepository implements UserRoleRepository {
  async listRolesByUserId(
    userId: string,
  ): Promise<{ userId: string; roleId: string }[]> {
    return db.select().from(userRoles).where(eq(userRoles.userId, userId));
  }

  async listUserIdsByRoleId(roleId: string): Promise<string[]> {
    const rows = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.roleId, roleId));
    return rows.map((row) => row.userId);
  }

  async listUserCountByRoleIds(
    roleIds: string[],
  ): Promise<Record<string, number>> {
    if (roleIds.length === 0) return {};
    const rows = await db
      .select({
        roleId: userRoles.roleId,
        count: sql<number>`count(*)`,
      })
      .from(userRoles)
      .where(inArray(userRoles.roleId, roleIds))
      .groupBy(userRoles.roleId);
    const out: Record<string, number> = {};
    for (const row of rows) {
      out[row.roleId] = Number(row.count);
    }
    return out;
  }

  async setUserRoles(userId: string, roleIds: string[]): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(userRoles).where(eq(userRoles.userId, userId));
      if (roleIds.length === 0) return;
      await tx
        .insert(userRoles)
        .values(roleIds.map((roleId) => ({ userId, roleId })));
    });
  }
}
