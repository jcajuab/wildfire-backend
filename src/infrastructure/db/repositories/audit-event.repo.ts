import { and, desc, eq, gte, lte, type SQL, sql } from "drizzle-orm";
import {
  type AuditEventRecord,
  type AuditEventRepository,
  type CreateAuditEventInput,
  type ListAuditEventsQuery,
} from "#/application/ports/audit";
import { db } from "#/infrastructure/db/client";
import { auditEvents } from "#/infrastructure/db/schema/audit.sql";
import { devices } from "#/infrastructure/db/schema/device.sql";
import { users } from "#/infrastructure/db/schema/rbac.sql";

const toRecord = (
  row: typeof auditEvents.$inferSelect & {
    actorName?: string | null;
    actorEmail?: string | null;
  },
): AuditEventRecord => ({
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
  actorType: (row.actorType as AuditEventRecord["actorType"]) ?? null,
  resourceId: row.resourceId ?? null,
  resourceType: row.resourceType ?? null,
  ipAddress: row.ipAddress ?? null,
  userAgent: row.userAgent ?? null,
  metadataJson: row.metadataJson ?? null,
  actorName: row.actorName ?? null,
  actorEmail: row.actorEmail ?? null,
});

const buildWhere = (query: ListAuditEventsQuery): SQL | undefined => {
  const predicates: SQL[] = [];

  if (query.from) {
    predicates.push(gte(auditEvents.occurredAt, new Date(query.from)));
  }
  if (query.to) {
    predicates.push(lte(auditEvents.occurredAt, new Date(query.to)));
  }
  if (query.actorId) {
    predicates.push(eq(auditEvents.actorId, query.actorId));
  }
  if (query.actorType) {
    predicates.push(eq(auditEvents.actorType, query.actorType));
  }
  if (query.action) {
    predicates.push(eq(auditEvents.action, query.action));
  }
  if (query.resourceType) {
    predicates.push(eq(auditEvents.resourceType, query.resourceType));
  }
  if (query.resourceId) {
    predicates.push(eq(auditEvents.resourceId, query.resourceId));
  }
  if (query.status) {
    predicates.push(eq(auditEvents.status, query.status));
  }
  if (query.requestId) {
    predicates.push(eq(auditEvents.requestId, query.requestId));
  }

  return predicates.length > 0 ? and(...predicates) : undefined;
};

export class AuditEventDbRepository implements AuditEventRepository {
  async create(input: CreateAuditEventInput): Promise<AuditEventRecord> {
    const id = crypto.randomUUID();

    await db.insert(auditEvents).values({
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
      .from(auditEvents)
      .where(eq(auditEvents.id, id))
      .limit(1);
    const record = row[0];
    if (!record) {
      throw new Error("Failed to load created audit event");
    }

    return toRecord(record);
  }

  async list(query: ListAuditEventsQuery): Promise<AuditEventRecord[]> {
    const where = buildWhere(query);
    const rows = await db
      .select({
        id: auditEvents.id,
        occurredAt: auditEvents.occurredAt,
        requestId: auditEvents.requestId,
        action: auditEvents.action,
        route: auditEvents.route,
        method: auditEvents.method,
        path: auditEvents.path,
        status: auditEvents.status,
        actorId: auditEvents.actorId,
        actorType: auditEvents.actorType,
        resourceId: auditEvents.resourceId,
        resourceType: auditEvents.resourceType,
        ipAddress: auditEvents.ipAddress,
        userAgent: auditEvents.userAgent,
        metadataJson: auditEvents.metadataJson,
        userName: users.name,
        userEmail: users.email,
        deviceName: devices.name,
        deviceIdentifier: devices.identifier,
      })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .leftJoin(devices, eq(devices.id, auditEvents.actorId))
      .where(where)
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(query.limit)
      .offset(query.offset);

    return rows.map((row) =>
      toRecord({
        ...row,
        actorName:
          row.actorType === "user"
            ? row.userName
            : row.actorType === "device"
              ? (row.deviceName ?? row.deviceIdentifier)
              : null,
        actorEmail: row.actorType === "user" ? row.userEmail : null,
      }),
    );
  }

  async count(query: ListAuditEventsQuery): Promise<number> {
    const where = buildWhere(query);
    const result = await db
      .select({ value: sql<number>`count(*)` })
      .from(auditEvents)
      .where(where);

    return result[0]?.value ?? 0;
  }
}
