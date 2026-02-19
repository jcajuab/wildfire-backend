import {
  index,
  int,
  mysqlTable,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const rbacPolicyHistory = mysqlTable(
  "rbac_policy_history",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    policyVersion: int("policy_version").notNull(),
    changeType: varchar("change_type", { length: 32 }).notNull(),
    targetId: varchar("target_id", { length: 36 }).notNull(),
    targetType: varchar("target_type", { length: 16 }).notNull(),
    actorId: varchar("actor_id", { length: 36 }),
    requestId: varchar("request_id", { length: 128 }),
    targetCount: int("target_count").notNull(),
    addedCount: int("added_count").notNull(),
    removedCount: int("removed_count").notNull(),
  },
  (table) => ({
    occurredAtIndex: index("rbac_policy_history_occurred_at_idx").on(
      table.occurredAt,
    ),
    policyVersionOccurredAtIndex: index(
      "rbac_policy_history_policy_version_occurred_at_idx",
    ).on(table.policyVersion, table.occurredAt),
    changeTypeOccurredAtIndex: index(
      "rbac_policy_history_change_type_occurred_at_idx",
    ).on(table.changeType, table.occurredAt),
    targetOccurredAtIndex: index(
      "rbac_policy_history_target_occurred_at_idx",
    ).on(table.targetId, table.occurredAt),
  }),
);
