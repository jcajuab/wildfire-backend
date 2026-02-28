import {
  index,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { displays } from "./display.sql";

export const displayAuthNonces = mysqlTable(
  "display_auth_nonces",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    displayId: varchar("display_id", { length: 36 })
      .notNull()
      .references(() => displays.id, { onDelete: "cascade" }),
    nonce: varchar("nonce", { length: 128 }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    displayNonceUnique: uniqueIndex(
      "display_auth_nonces_display_nonce_unique",
    ).on(table.displayId, table.nonce),
    expiresAtIndex: index("display_auth_nonces_expires_at_idx").on(
      table.expiresAt,
    ),
  }),
);
