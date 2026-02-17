import { eq } from "drizzle-orm";
import { type AuthorizationRepository } from "#/application/ports/rbac";
import { Permission } from "#/domain/rbac/permission";
import { db } from "#/infrastructure/db/client";
import {
  permissions,
  rolePermissions,
  userRoles,
} from "#/infrastructure/db/schema/rbac.sql";

export class AuthorizationDbRepository implements AuthorizationRepository {
  async findPermissionsForUser(userId: string): Promise<Permission[]> {
    const rows = await db
      .selectDistinct({
        resource: permissions.resource,
        action: permissions.action,
      })
      .from(userRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(userRoles.userId, userId));

    return rows.map((row) => Permission.parse(`${row.resource}:${row.action}`));
  }
}
