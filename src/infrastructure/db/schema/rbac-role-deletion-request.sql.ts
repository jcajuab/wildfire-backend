import { index, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";

export const rbacRoleDeletionRequests = mysqlTable(
  "rbac_role_deletion_requests",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    roleId: varchar("role_id", { length: 36 }).notNull(),
    requestedByUserId: varchar("requested_by_user_id", {
      length: 36,
    }).notNull(),
    requestedAt: timestamp("requested_at").notNull().defaultNow(),
    status: varchar("status", { length: 16 }).notNull(),
    approvedByUserId: varchar("approved_by_user_id", { length: 36 }),
    approvedAt: timestamp("approved_at"),
    reason: varchar("reason", { length: 1024 }),
  },
  (table) => ({
    roleIdIndex: index("rbac_role_deletion_requests_role_id_idx").on(
      table.roleId,
    ),
    statusRequestedAtIndex: index(
      "rbac_role_deletion_requests_status_requested_at_idx",
    ).on(table.status, table.requestedAt),
  }),
);
