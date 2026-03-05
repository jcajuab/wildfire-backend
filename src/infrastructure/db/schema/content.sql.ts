import {
  type AnyMySqlColumn,
  boolean,
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
    kind: varchar("kind", { length: 16 }).notNull().default("ROOT"),
    status: varchar("status", { length: 16 }).notNull().default("PROCESSING"),
    fileKey: varchar("file_key", { length: 512 }).notNull(),
    thumbnailKey: varchar("thumbnail_key", { length: 512 }),
    parentContentId: varchar("parent_content_id", { length: 36 }).references(
      (): AnyMySqlColumn => content.id,
      { onDelete: "cascade" },
    ),
    pageNumber: int("page_number"),
    pageCount: int("page_count"),
    isExcluded: boolean("is_excluded").notNull().default(false),
    checksum: varchar("checksum", { length: 128 }).notNull(),
    mimeType: varchar("mime_type", { length: 120 }).notNull(),
    fileSize: int("file_size").notNull(),
    width: int("width"),
    height: int("height"),
    duration: int("duration"),
    flashMessage: varchar("flash_message", { length: 240 }),
    flashTone: varchar("flash_tone", { length: 16 }),
    createdById: varchar("created_by_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    statusIndex: index("content_status_idx").on(table.status),
    typeIndex: index("content_type_idx").on(table.type),
    kindIndex: index("content_kind_idx").on(table.kind),
    parentContentIdIndex: index("content_parent_content_id_idx").on(
      table.parentContentId,
    ),
    isExcludedIndex: index("content_is_excluded_idx").on(table.isExcluded),
    createdAtIndex: index("content_created_at_idx").on(table.createdAt),
    fileSizeIndex: index("content_file_size_idx").on(table.fileSize),
    statusTypeCreatedAtIndex: index("content_status_type_created_at_idx").on(
      table.status,
      table.type,
      table.createdAt,
    ),
  }),
);
