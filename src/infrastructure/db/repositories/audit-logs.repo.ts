import { and, desc, eq, gte, like, lte, type SQL, sql } from "drizzle-orm";
import {
  type AuditLogRecord,
  type AuditLogRepository,
  type CreateAuditLogInput,
  type ListAuditLogsQuery,
} from "#/application/ports/audit";
import { db } from "#/infrastructure/db/client";
import { auditLogs } from "#/infrastructure/db/schema/audit-logs.sql";
import { displays } from "#/infrastructure/db/schema/displays.sql";
import { users } from "#/infrastructure/db/schema/rbac.sql";
import { buildLikeContainsPattern } from "#/infrastructure/db/utils/sql";

const mapAuditLogRowToRecord = (
  row: typeof auditLogs.$inferSelect & {
    actorName?: string | null;
    actorEmail?: string | null;
  },
): AuditLogRecord => ({
  id: row.id,
  occurredAt:
    row.occurredAt instanceof Date
      ? row.occurredAt.toISOString()
      : row.occurredAt,
  requestId: row.requestId ?? null,
  action: row.action,
  route: row.route ?? null,
  method: row.method,
  path: row.path,
  status: row.status,
  actorId: row.actorId ?? null,
  actorType: (row.actorType as AuditLogRecord["actorType"]) ?? null,
  resourceId: row.resourceId ?? null,
  resourceType: row.resourceType ?? null,
  ipAddress: row.ipAddress ?? null,
  userAgent: row.userAgent ?? null,
  metadataJson: row.metadataJson ?? null,
  actorName: row.actorName ?? null,
  actorEmail: row.actorEmail ?? null,
});

const buildWhere = (query: ListAuditLogsQuery): SQL | undefined => {
  const predicates: SQL[] = [];

  if (query.from) {
    predicates.push(gte(auditLogs.occurredAt, new Date(query.from)));
  }
  if (query.to) {
    predicates.push(lte(auditLogs.occurredAt, new Date(query.to)));
  }
  if (query.actorId) {
    predicates.push(eq(auditLogs.actorId, query.actorId));
  }
  if (query.actorType) {
    predicates.push(eq(auditLogs.actorType, query.actorType));
  }
  if (query.action) {
    predicates.push(
      like(auditLogs.action, buildLikeContainsPattern(query.action)),
    );
  }
  if (query.resourceType) {
    predicates.push(
      like(
        auditLogs.resourceType,
        buildLikeContainsPattern(query.resourceType),
      ),
    );
  }
  if (query.resourceId) {
    predicates.push(eq(auditLogs.resourceId, query.resourceId));
  }
  if (query.status) {
    predicates.push(eq(auditLogs.status, query.status));
  }
  if (query.requestId) {
    predicates.push(
      like(auditLogs.requestId, buildLikeContainsPattern(query.requestId)),
    );
  }

  return predicates.length > 0 ? and(...predicates) : undefined;
};

export class AuditLogDbRepository implements AuditLogRepository {
  async create(input: CreateAuditLogInput): Promise<AuditLogRecord> {
    const id = crypto.randomUUID();

    await db.insert(auditLogs).values({
      id,
      occurredAt: input.occurredAt,
      requestId: input.requestId ?? null,
      action: input.action,
      route: input.route ?? null,
      method: input.method,
      path: input.path,
      status: input.status,
      actorId: input.actorId ?? null,
      actorType: input.actorType ?? null,
      resourceId: input.resourceId ?? null,
      resourceType: input.resourceType ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadataJson: input.metadataJson ?? null,
    });

    const row = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.id, id))
      .limit(1);
    const record = row[0];
    if (!record) {
      throw new Error("Failed to load created audit event");
    }

    return mapAuditLogRowToRecord(record);
  }

  async list(query: ListAuditLogsQuery): Promise<AuditLogRecord[]> {
    const where = buildWhere(query);
    const rows = await db
      .select({
        id: auditLogs.id,
        occurredAt: auditLogs.occurredAt,
        requestId: auditLogs.requestId,
        action: auditLogs.action,
        route: auditLogs.route,
        method: auditLogs.method,
        path: auditLogs.path,
        status: auditLogs.status,
        actorId: auditLogs.actorId,
        actorType: auditLogs.actorType,
        resourceId: auditLogs.resourceId,
        resourceType: auditLogs.resourceType,
        ipAddress: auditLogs.ipAddress,
        userAgent: auditLogs.userAgent,
        metadataJson: auditLogs.metadataJson,
        userName: users.name,
        userEmail: users.email,
        displayName: displays.name,
        displayIdentifier: displays.slug,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .leftJoin(displays, eq(displays.id, auditLogs.actorId))
      .where(where)
      .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
      .limit(query.limit)
      .offset(query.offset);

    return rows.map((row) =>
      mapAuditLogRowToRecord({
        ...row,
        actorName:
          row.actorType === "user"
            ? row.userName
            : row.actorType === "display"
              ? (row.displayName ?? row.displayIdentifier)
              : null,
        actorEmail: row.actorType === "user" ? row.userEmail : null,
      }),
    );
  }

  async count(query: ListAuditLogsQuery): Promise<number> {
    const where = buildWhere(query);
    const result = await db
      .select({ value: sql<number>`count(*)` })
      .from(auditLogs)
      .where(where);

    return result[0]?.value ?? 0;
  }

  async deleteByRequestIdPrefix(prefix: string): Promise<number> {
    const result = await db
      .delete(auditLogs)
      .where(like(auditLogs.requestId, buildLikeContainsPattern(prefix)));
    return Number(result[0]?.affectedRows ?? 0);
  }
}
