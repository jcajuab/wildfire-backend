import {
  index,
  int,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const auditEvents = mysqlTable(
  "audit_events",
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
    actorType: varchar("actor_type", { length: 16 }),
    resourceId: varchar("resource_id", { length: 36 }),
    resourceType: varchar("resource_type", { length: 120 }),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: varchar("user_agent", { length: 255 }),
    metadataJson: text("metadata_json"),
  },
  (table) => ({
    occurredAtIndex: index("audit_events_occurred_at_idx").on(table.occurredAt),
    actorOccurredAtIndex: index("audit_events_actor_occurred_idx").on(
      table.actorId,
      table.occurredAt,
    ),
    actionOccurredAtIndex: index("audit_events_action_occurred_idx").on(
      table.action,
      table.occurredAt,
    ),
    resourceOccurredAtIndex: index("audit_events_resource_occurred_idx").on(
      table.resourceType,
      table.resourceId,
      table.occurredAt,
    ),
    statusOccurredAtIndex: index("audit_events_status_occurred_idx").on(
      table.status,
      table.occurredAt,
    ),
    requestIdIndex: index("audit_events_request_id_idx").on(table.requestId),
  }),
);
