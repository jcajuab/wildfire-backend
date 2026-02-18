import {
  index,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const invitations = mysqlTable(
  "invitations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    hashedToken: varchar("hashed_token", { length: 64 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }),
    invitedByUserId: varchar("invited_by_user_id", { length: 36 }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    hashedTokenUnique: uniqueIndex("inv_hash_token_unique").on(
      table.hashedToken,
    ),
    emailIndex: index("inv_email_idx").on(table.email),
    expiresAtIndex: index("inv_expires_at_idx").on(table.expiresAt),
    invitedByUserIdIndex: index("inv_invited_by_user_id_idx").on(
      table.invitedByUserId,
    ),
  }),
);
