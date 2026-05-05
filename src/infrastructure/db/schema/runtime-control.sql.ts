import {
  boolean,
  mysqlTable,
  timestamp,
  tinyint,
  varchar,
} from "drizzle-orm/mysql-core";

export const runtimeControl = mysqlTable("runtime_control", {
  id: varchar("id", { length: 32 }).primaryKey(),
  globalEmergencyActive: boolean("global_emergency_active")
    .notNull()
    .default(false),
  globalEmergencyStartedAt: timestamp("global_emergency_started_at"),
  activeSlotIndex: tinyint("active_slot_index"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
