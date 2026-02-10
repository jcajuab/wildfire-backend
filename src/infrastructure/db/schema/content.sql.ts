import { int, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import { users } from "./rbac.sql";

export const content = mysqlTable("content", {
  id: varchar("id", { length: 36 }).primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  type: varchar("type", { length: 16 }).notNull(),
  fileKey: varchar("file_key", { length: 512 }).notNull(),
  checksum: varchar("checksum", { length: 128 }).notNull(),
  mimeType: varchar("mime_type", { length: 120 }).notNull(),
  fileSize: int("file_size").notNull(),
  width: int("width"),
  height: int("height"),
  duration: int("duration"),
  createdById: varchar("created_by_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
