import { eq } from "drizzle-orm";
import { type RolePermissionRepository } from "#/application/ports/rbac";
import { db } from "#/infrastructure/db/client";
import { rolePermissions } from "#/infrastructure/db/schema/rbac.sql";

export class RolePermissionDbRepository implements RolePermissionRepository {
  async listPermissionsByRoleId(
    roleId: string,
  ): Promise<{ roleId: string; permissionId: string }[]> {
    return db
      .select()
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId));
  }

  async setRolePermissions(
    roleId: string,
    permissionIds: string[],
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .delete(rolePermissions)
        .where(eq(rolePermissions.roleId, roleId));
      if (permissionIds.length === 0) return;
      await tx
        .insert(rolePermissions)
        .values(
          permissionIds.map((permissionId) => ({ roleId, permissionId })),
        );
    });
  }
}
