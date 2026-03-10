import {
  type AnyMySqlColumn,
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { users } from "./rbac.sql";

export const content = mysqlTable(
  "content",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    title: varchar("title", { length: 255 }).notNull(),
    type: mysqlEnum("type", [
      "IMAGE",
      "VIDEO",
      "PDF",
      "FLASH",
      "TEXT",
    ]).notNull(),
    kind: mysqlEnum("kind", ["ROOT", "PAGE"]).notNull().default("ROOT"),
    status: mysqlEnum("status", ["PROCESSING", "READY", "FAILED"])
      .notNull()
      .default("PROCESSING"),
    parentContentId: varchar("parent_content_id", { length: 36 }).references(
      (): AnyMySqlColumn => content.id,
      { onDelete: "cascade" },
    ),
    pageNumber: int("page_number"),
    pageCount: int("page_count"),
    isExcluded: boolean("is_excluded").notNull().default(false),
    ownerId: varchar("owner_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
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
    statusTypeCreatedAtIndex: index("content_status_type_created_at_idx").on(
      table.status,
      table.type,
      table.createdAt,
    ),
  }),
);

export const contentAssets = mysqlTable(
  "content_assets",
  {
    contentId: varchar("content_id", { length: 36 })
      .primaryKey()
      .references(() => content.id, { onDelete: "cascade" }),
    fileKey: varchar("file_key", { length: 512 }).notNull(),
    thumbnailKey: varchar("thumbnail_key", { length: 512 }),
    checksum: varchar("checksum", { length: 128 }).notNull(),
    mimeType: varchar("mime_type", { length: 120 }).notNull(),
    fileSize: int("file_size").notNull(),
    width: int("width"),
    height: int("height"),
    duration: int("duration"),
    scrollPxPerSecond: int("scroll_px_per_second"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    fileKeyUnique: uniqueIndex("content_assets_file_key_unique").on(
      table.fileKey,
    ),
    mimeTypeIndex: index("content_assets_mime_type_idx").on(table.mimeType),
    fileSizeIndex: index("content_assets_file_size_idx").on(table.fileSize),
  }),
);

export const contentFlashMessages = mysqlTable(
  "content_flash_messages",
  {
    contentId: varchar("content_id", { length: 36 })
      .primaryKey()
      .references(() => content.id, { onDelete: "cascade" }),
    message: varchar("message", { length: 240 }).notNull(),
    tone: mysqlEnum("tone", ["INFO", "WARNING", "CRITICAL"])
      .notNull()
      .default("INFO"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    toneIndex: index("content_flash_messages_tone_idx").on(table.tone),
  }),
);

export const contentTextContent = mysqlTable("content_text_content", {
  contentId: varchar("content_id", { length: 36 })
    .primaryKey()
    .references(() => content.id, { onDelete: "cascade" }),
  jsonContent: text("json_content").notNull(),
  htmlContent: text("html_content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
