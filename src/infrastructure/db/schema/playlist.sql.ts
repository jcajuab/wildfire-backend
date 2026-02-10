import { mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";
import { users } from "./rbac.sql";

export const playlists = mysqlTable("playlists", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  createdById: varchar("created_by_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
