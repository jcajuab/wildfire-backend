import {
  index,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { pairingCodes } from "./pairing-code.sql";

export const displayPairingSessions = mysqlTable(
  "display_pairing_sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    pairingCodeId: varchar("pairing_code_id", { length: 36 })
      .notNull()
      .references(() => pairingCodes.id, { onDelete: "cascade" }),
    state: varchar("state", { length: 24 }).notNull().default("open"),
    challengeNonce: varchar("challenge_nonce", { length: 128 }).notNull(),
    challengeExpiresAt: timestamp("challenge_expires_at").notNull(),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    pairingCodeUnique: uniqueIndex(
      "display_pairing_sessions_pairing_code_id_unique",
    ).on(table.pairingCodeId),
    stateIndex: index("display_pairing_sessions_state_idx").on(table.state),
    challengeExpiresIndex: index(
      "display_pairing_sessions_challenge_expires_at_idx",
    ).on(table.challengeExpiresAt),
  }),
);
