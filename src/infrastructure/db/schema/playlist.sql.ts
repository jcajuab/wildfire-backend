import {
  index,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";
import { users } from "./rbac.sql";

export const playlists = mysqlTable(
  "playlists",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 16 }).notNull().default("DRAFT"),
    createdById: varchar("created_by_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    statusIndex: index("playlists_status_idx").on(table.status),
    nameIndex: index("playlists_name_idx").on(table.name),
    updatedAtIndex: index("playlists_updated_at_idx").on(table.updatedAt),
    statusUpdatedAtIndex: index("playlists_status_updated_at_idx").on(
      table.status,
      table.updatedAt,
    ),
  }),
);
