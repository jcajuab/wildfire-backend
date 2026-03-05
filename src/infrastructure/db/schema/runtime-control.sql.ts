import {
  boolean,
  mysqlTable,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const runtimeControl = mysqlTable("runtime_control", {
  id: varchar("id", { length: 32 }).primaryKey(),
  globalEmergencyActive: boolean("global_emergency_active")
    .notNull()
    .default(false),
  globalEmergencyStartedAt: timestamp("global_emergency_started_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
