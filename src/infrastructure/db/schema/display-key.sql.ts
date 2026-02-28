import {
  index,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { displays } from "./display.sql";

export const displayKeys = mysqlTable(
  "display_keys",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    displayId: varchar("display_id", { length: 36 })
      .notNull()
      .references(() => displays.id, { onDelete: "cascade" }),
    algorithm: varchar("algorithm", { length: 16 }).notNull(),
    publicKey: varchar("public_key", { length: 4096 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    keyIdUnique: uniqueIndex("display_keys_id_unique").on(table.id),
    displayIdUnique: uniqueIndex("display_keys_display_id_unique").on(
      table.displayId,
    ),
    statusIndex: index("display_keys_status_idx").on(table.status),
  }),
);
