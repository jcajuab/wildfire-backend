import {
  index,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { users } from "./rbac.sql";

export const aiCredentials = mysqlTable(
  "ai_credentials",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 32 }).notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    keyHint: varchar("key_hint", { length: 8 }).notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userProviderUnique: uniqueIndex("ai_credentials_user_provider_unique").on(
      table.userId,
      table.provider,
    ),
    userIdIndex: index("ai_credentials_user_id_idx").on(table.userId),
  }),
);
