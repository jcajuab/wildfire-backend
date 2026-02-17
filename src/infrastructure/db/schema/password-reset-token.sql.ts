import { index, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";

export const passwordResetTokens = mysqlTable(
  "password_reset_tokens",
  {
    hashedToken: varchar("hashed_token", { length: 64 }).primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    emailIndex: index("prt_email_idx").on(table.email),
    expiresAtIndex: index("prt_expires_at_idx").on(table.expiresAt),
  }),
);
