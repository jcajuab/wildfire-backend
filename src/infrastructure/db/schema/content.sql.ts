import {
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
    type: mysqlEnum("type", ["IMAGE", "VIDEO", "FLASH", "TEXT"]).notNull(),
    status: mysqlEnum("status", ["PROCESSING", "READY", "FAILED"])
      .notNull()
      .default("PROCESSING"),
    ownerId: varchar("owner_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index("content_status_idx").on(table.status),
    typeIdx: index("content_type_idx").on(table.type),
    ownerIdIdx: index("content_owner_id_idx").on(table.ownerId),
    createdAtIdx: index("content_created_at_idx").on(table.createdAt),
    statusTypeCreatedAtIdx: index("content_status_type_created_at_idx").on(
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
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    fileKeyUniqueIdx: uniqueIndex("content_assets_file_key_unique").on(
      table.fileKey,
    ),
    mimeTypeIdx: index("content_assets_mime_type_idx").on(table.mimeType),
    fileSizeIdx: index("content_assets_file_size_idx").on(table.fileSize),
  }),
);

export const contentFlashMessages = mysqlTable("content_flash_messages", {
  contentId: varchar("content_id", { length: 36 })
    .primaryKey()
    .references(() => content.id, { onDelete: "cascade" }),
  message: varchar("message", { length: 240 }).notNull(),
  tone: mysqlEnum("tone", ["INFO", "WARNING", "CRITICAL"])
    .notNull()
    .default("INFO"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const contentTextContent = mysqlTable("content_text_content", {
  contentId: varchar("content_id", { length: 36 })
    .primaryKey()
    .references(() => content.id, { onDelete: "cascade" }),
  jsonContent: text("json_content").notNull(),
  htmlContent: text("html_content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
