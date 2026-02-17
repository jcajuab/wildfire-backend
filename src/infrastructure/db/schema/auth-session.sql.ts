import { index, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import { users } from "#/infrastructure/db/schema/rbac.sql";

export const authSessions = mysqlTable(
  "auth_sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdIndex: index("auth_sessions_user_id_idx").on(table.userId),
    expiresAtIndex: index("auth_sessions_expires_at_idx").on(table.expiresAt),
  }),
);
