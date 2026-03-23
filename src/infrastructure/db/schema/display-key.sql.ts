import {
  index,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { displays } from "./displays.sql";

export const displayKeyPairs = mysqlTable(
  "display_key_pairs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    displayId: varchar("display_id", { length: 36 })
      .notNull()
      .references(() => displays.id, { onDelete: "cascade" }),
    algorithm: mysqlEnum("algorithm", ["ed25519"]).notNull(),
    publicKey: varchar("public_key", { length: 4096 }).notNull(),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    displayIdCreatedAtIndex: index(
      "display_key_pairs_display_id_created_idx",
    ).on(table.displayId, table.createdAt),
    displayIdRevokedAtIndex: index(
      "display_key_pairs_display_id_revoked_idx",
    ).on(table.displayId, table.revokedAt),
  }),
);

export const displayActiveKeys = mysqlTable(
  "display_active_keys",
  {
    displayId: varchar("display_id", { length: 36 })
      .primaryKey()
      .references(() => displays.id, { onDelete: "cascade" }),
    keyPairId: varchar("key_pair_id", { length: 36 })
      .notNull()
      .references(() => displayKeyPairs.id, { onDelete: "cascade" }),
    activatedAt: timestamp("activated_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    keyPairIdUnique: uniqueIndex("display_active_keys_key_pair_id_unique").on(
      table.keyPairId,
    ),
  }),
);
