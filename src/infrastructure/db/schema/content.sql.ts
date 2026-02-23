import {
  index,
  int,
  mysqlTable,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";
import { users } from "./rbac.sql";

export const content = mysqlTable(
  "content",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    title: varchar("title", { length: 255 }).notNull(),
    type: varchar("type", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("DRAFT"),
    fileKey: varchar("file_key", { length: 512 }).notNull(),
    thumbnailKey: varchar("thumbnail_key", { length: 512 }),
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
  },
  (table) => ({
    statusIndex: index("content_status_idx").on(table.status),
    typeIndex: index("content_type_idx").on(table.type),
    createdAtIndex: index("content_created_at_idx").on(table.createdAt),
    fileSizeIndex: index("content_file_size_idx").on(table.fileSize),
    statusTypeCreatedAtIndex: index("content_status_type_created_at_idx").on(
      table.status,
      table.type,
      table.createdAt,
    ),
  }),
);
