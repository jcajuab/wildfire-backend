import {
  index,
  mysqlEnum,
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
    status: mysqlEnum("status", ["DRAFT", "IN_USE"]).notNull().default("DRAFT"),
    ownerId: varchar("owner_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index("playlists_status_idx").on(table.status),
    nameIdx: index("playlists_name_idx").on(table.name),
    ownerIdIdx: index("playlists_owner_id_idx").on(table.ownerId),
    updatedAtIdx: index("playlists_updated_at_idx").on(table.updatedAt),
    statusUpdatedAtIdx: index("playlists_status_updated_at_idx").on(
      table.status,
      table.updatedAt,
    ),
  }),
);
