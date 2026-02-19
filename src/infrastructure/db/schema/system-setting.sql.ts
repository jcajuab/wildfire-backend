import { mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const systemSettings = mysqlTable("system_settings", {
  key: varchar("key", { length: 128 }).primaryKey(),
  value: text("value").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});
