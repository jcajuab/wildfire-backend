import { and, desc, eq, type SQL, sql } from "drizzle-orm";
import {
  type RoleDeletionRequestRecord,
  type RoleDeletionRequestRepository,
} from "#/application/ports/rbac";
import { db } from "#/infrastructure/db/client";
import { roles, users } from "#/infrastructure/db/schema/rbac.sql";
import { roleDeletionRequests } from "#/infrastructure/db/schema/role-deletion-request.sql";

const toIso = (value: Date | string | null): string | null => {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
};

const buildWhere = (input: {
  status?: "pending" | "approved" | "rejected" | "cancelled";
  roleId?: string;
}): SQL | undefined => {
  const predicates: SQL[] = [];
  if (input.status) {
    predicates.push(eq(roleDeletionRequests.status, input.status));
  }
  if (input.roleId) {
    predicates.push(eq(roleDeletionRequests.roleId, input.roleId));
  }
  return predicates.length > 0 ? and(...predicates) : undefined;
};

export class RoleDeletionRequestDbRepository
  implements RoleDeletionRequestRepository
{
  private async listInternal(input: {
    offset: number;
    limit: number;
    status?: "pending" | "approved" | "rejected" | "cancelled";
    roleId?: string;
    id?: string;
  }): Promise<RoleDeletionRequestRecord[]> {
    const where = buildWhere(input);
    const predicates = input.id
      ? where
        ? and(where, eq(roleDeletionRequests.id, input.id))
        : eq(roleDeletionRequests.id, input.id)
      : where;

    const rows = await db
      .select({
        id: roleDeletionRequests.id,
        roleId: roleDeletionRequests.roleId,
        roleName: roles.name,
        requestedByUserId: roleDeletionRequests.requestedByUserId,
        requestedByName: users.name,
        requestedByEmail: users.email,
        requestedAt: roleDeletionRequests.requestedAt,
        status: roleDeletionRequests.status,
        approvedByUserId: roleDeletionRequests.approvedByUserId,
        approvedAt: roleDeletionRequests.approvedAt,
        reason: roleDeletionRequests.reason,
      })
      .from(roleDeletionRequests)
      .innerJoin(roles, eq(roles.id, roleDeletionRequests.roleId))
      .innerJoin(users, eq(users.id, roleDeletionRequests.requestedByUserId))
      .where(predicates)
      .orderBy(
        desc(roleDeletionRequests.requestedAt),
        desc(roleDeletionRequests.id),
      )
      .offset(input.offset)
      .limit(input.limit);

    return rows.map((row) => ({
      id: row.id,
      roleId: row.roleId,
      roleName: row.roleName,
      requestedByUserId: row.requestedByUserId,
      requestedByName: row.requestedByName,
      requestedByEmail: row.requestedByEmail,
      requestedAt: toIso(row.requestedAt) ?? new Date(0).toISOString(),
      status: row.status as RoleDeletionRequestRecord["status"],
      approvedByUserId: row.approvedByUserId ?? null,
      approvedByName: null,
      approvedByEmail: null,
      approvedAt: toIso(row.approvedAt),
      reason: row.reason ?? null,
    }));
  }

  async createPending(input: {
    roleId: string;
    requestedByUserId: string;
    reason?: string;
  }): Promise<void> {
    await db.insert(roleDeletionRequests).values({
      id: crypto.randomUUID(),
      roleId: input.roleId,
      requestedByUserId: input.requestedByUserId,
      status: "pending",
      reason: input.reason ?? null,
    });
  }

  async findPendingByRoleId(
    roleId: string,
  ): Promise<RoleDeletionRequestRecord | null> {
    const rows = await this.list({
      offset: 0,
      limit: 1,
      roleId,
      status: "pending",
    });
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<RoleDeletionRequestRecord | null> {
    const rows = await this.listInternal({ offset: 0, limit: 1, id });
    return rows[0] ?? null;
  }

  async list(input: {
    offset: number;
    limit: number;
    status?: "pending" | "approved" | "rejected" | "cancelled";
    roleId?: string;
  }): Promise<RoleDeletionRequestRecord[]> {
    return this.listInternal(input);
  }

  async count(input: {
    status?: "pending" | "approved" | "rejected" | "cancelled";
    roleId?: string;
  }): Promise<number> {
    const where = buildWhere(input);
    const result = await db
      .select({ value: sql<number>`count(*)` })
      .from(roleDeletionRequests)
      .where(where);
    return result[0]?.value ?? 0;
  }

  async markApproved(input: {
    id: string;
    approvedByUserId: string;
  }): Promise<boolean> {
    const result = await db
      .update(roleDeletionRequests)
      .set({
        status: "approved",
        approvedByUserId: input.approvedByUserId,
        approvedAt: new Date(),
      })
      .where(
        and(
          eq(roleDeletionRequests.id, input.id),
          eq(roleDeletionRequests.status, "pending"),
        ),
      );
    return (result as { rowsAffected?: number }).rowsAffected !== 0;
  }

  async markRejected(input: {
    id: string;
    approvedByUserId: string;
    reason?: string;
  }): Promise<boolean> {
    const result = await db
      .update(roleDeletionRequests)
      .set({
        status: "rejected",
        approvedByUserId: input.approvedByUserId,
        approvedAt: new Date(),
        reason: input.reason ?? null,
      })
      .where(
        and(
          eq(roleDeletionRequests.id, input.id),
          eq(roleDeletionRequests.status, "pending"),
        ),
      );
    return (result as { rowsAffected?: number }).rowsAffected !== 0;
  }
}
