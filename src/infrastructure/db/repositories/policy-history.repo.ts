import { and, desc, eq, gte, lte, type SQL, sql } from "drizzle-orm";
import {
  type PolicyHistoryRecord,
  type PolicyHistoryRepository,
} from "#/application/ports/rbac";
import { db } from "#/infrastructure/db/client";
import { policyHistory } from "#/infrastructure/db/schema/policy-history.sql";
import { users } from "#/infrastructure/db/schema/rbac.sql";

const buildWhere = (input: {
  policyVersion?: number;
  changeType?: "role_permissions" | "user_roles";
  targetId?: string;
  actorId?: string;
  from?: string;
  to?: string;
}): SQL | undefined => {
  const predicates: SQL[] = [];
  if (input.policyVersion !== undefined) {
    predicates.push(eq(policyHistory.policyVersion, input.policyVersion));
  }
  if (input.changeType) {
    predicates.push(eq(policyHistory.changeType, input.changeType));
  }
  if (input.targetId) {
    predicates.push(eq(policyHistory.targetId, input.targetId));
  }
  if (input.actorId) {
    predicates.push(eq(policyHistory.actorId, input.actorId));
  }
  if (input.from) {
    predicates.push(gte(policyHistory.occurredAt, new Date(input.from)));
  }
  if (input.to) {
    predicates.push(lte(policyHistory.occurredAt, new Date(input.to)));
  }
  return predicates.length > 0 ? and(...predicates) : undefined;
};

export class PolicyHistoryDbRepository implements PolicyHistoryRepository {
  async create(input: {
    policyVersion: number;
    changeType: "role_permissions" | "user_roles";
    targetId: string;
    targetType: "role" | "user";
    actorId?: string;
    requestId?: string;
    targetCount: number;
    addedCount: number;
    removedCount: number;
  }): Promise<void> {
    await db.insert(policyHistory).values({
      id: crypto.randomUUID(),
      policyVersion: input.policyVersion,
      changeType: input.changeType,
      targetId: input.targetId,
      targetType: input.targetType,
      actorId: input.actorId ?? null,
      requestId: input.requestId ?? null,
      targetCount: input.targetCount,
      addedCount: input.addedCount,
      removedCount: input.removedCount,
    });
  }

  async list(input: {
    offset: number;
    limit: number;
    policyVersion?: number;
    changeType?: "role_permissions" | "user_roles";
    targetId?: string;
    actorId?: string;
    from?: string;
    to?: string;
  }): Promise<PolicyHistoryRecord[]> {
    const where = buildWhere(input);
    const rows = await db
      .select({
        id: policyHistory.id,
        occurredAt: policyHistory.occurredAt,
        policyVersion: policyHistory.policyVersion,
        changeType: policyHistory.changeType,
        targetId: policyHistory.targetId,
        targetType: policyHistory.targetType,
        actorId: policyHistory.actorId,
        requestId: policyHistory.requestId,
        targetCount: policyHistory.targetCount,
        addedCount: policyHistory.addedCount,
        removedCount: policyHistory.removedCount,
        actorName: users.name,
        actorEmail: users.email,
      })
      .from(policyHistory)
      .leftJoin(users, eq(users.id, policyHistory.actorId))
      .where(where)
      .orderBy(desc(policyHistory.occurredAt), desc(policyHistory.id))
      .offset(input.offset)
      .limit(input.limit);

    return rows.map((row) => ({
      id: row.id,
      occurredAt:
        row.occurredAt instanceof Date
          ? row.occurredAt.toISOString()
          : row.occurredAt,
      policyVersion: row.policyVersion,
      changeType: row.changeType as PolicyHistoryRecord["changeType"],
      targetId: row.targetId,
      targetType: row.targetType as PolicyHistoryRecord["targetType"],
      actorId: row.actorId ?? null,
      actorName: row.actorName ?? null,
      actorEmail: row.actorEmail ?? null,
      requestId: row.requestId ?? null,
      targetCount: row.targetCount,
      addedCount: row.addedCount,
      removedCount: row.removedCount,
    }));
  }

  async count(input: {
    policyVersion?: number;
    changeType?: "role_permissions" | "user_roles";
    targetId?: string;
    actorId?: string;
    from?: string;
    to?: string;
  }): Promise<number> {
    const where = buildWhere(input);
    const result = await db
      .select({ value: sql<number>`count(*)` })
      .from(policyHistory)
      .where(where);
    return result[0]?.value ?? 0;
  }
}
