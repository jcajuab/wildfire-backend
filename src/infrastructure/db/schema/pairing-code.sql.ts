import {
  index,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const pairingCodes = mysqlTable(
  "pairing_codes",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdById: varchar("created_by_id", { length: 36 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    codeHashUnique: uniqueIndex("pairing_codes_code_hash_unique").on(
      table.codeHash,
    ),
    expiresAtIndex: index("pairing_codes_expires_at_idx").on(table.expiresAt),
    usedAtIndex: index("pairing_codes_used_at_idx").on(table.usedAt),
  }),
);
