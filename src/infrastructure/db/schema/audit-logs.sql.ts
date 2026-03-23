import {
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

// Partition strategy: audit_logs is currently unpartitioned. When row count
// exceeds ~10M, partition by RANGE on occurred_at (monthly buckets) to keep
// index scans fast and allow cheap historical data archival via DROP PARTITION.
export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    requestId: varchar("request_id", { length: 128 }),
    action: varchar("action", { length: 160 }).notNull(),
    route: varchar("route", { length: 255 }),
    method: varchar("method", { length: 10 }).notNull(),
    path: varchar("path", { length: 255 }).notNull(),
    status: int("status").notNull(),
    actorId: varchar("actor_id", { length: 36 }),
    actorType: mysqlEnum("actor_type", ["user", "display"]),
    resourceId: varchar("resource_id", { length: 36 }),
    resourceType: varchar("resource_type", { length: 120 }),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: varchar("user_agent", { length: 255 }),
    metadataJson: text("metadata_json"),
  },
  (table) => ({
    occurredAtIndex: index("audit_logs_occurred_at_idx").on(table.occurredAt),
    actorOccurredAtIndex: index("audit_logs_actor_occurred_idx").on(
      table.actorId,
      table.occurredAt,
    ),
    actionOccurredAtIndex: index("audit_logs_action_occurred_idx").on(
      table.action,
      table.occurredAt,
    ),
    resourceOccurredAtIndex: index("audit_logs_resource_occurred_idx").on(
      table.resourceType,
      table.resourceId,
      table.occurredAt,
    ),
    statusOccurredAtIndex: index("audit_logs_status_occurred_idx").on(
      table.status,
      table.occurredAt,
    ),
    requestIdIndex: index("audit_logs_request_id_idx").on(table.requestId),
  }),
);
