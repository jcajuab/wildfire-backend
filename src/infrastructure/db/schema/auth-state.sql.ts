import {
  index,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { users } from "./rbac.sql";

export const authSessions = mysqlTable(
  "auth_sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index("auth_sessions_user_id_idx").on(table.userId),
    expiresAtIdx: index("auth_sessions_expires_at_idx").on(table.expiresAt),
    userExpiresAtIdx: index("auth_sessions_user_expires_at_idx").on(
      table.userId,
      table.expiresAt,
    ),
  }),
);

export const invitations = mysqlTable(
  "invitations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    hashedToken: varchar("hashed_token", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }),
    invitedByUserId: varchar("invited_by_user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    encryptedToken: text("encrypted_token"),
    tokenIv: text("token_iv"),
    tokenAuthTag: text("token_auth_tag"),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    hashedTokenUnique: uniqueIndex("invitations_hashed_token_unique").on(
      table.hashedToken,
    ),
    emailCreatedAtIdx: index("invitations_email_created_at_idx").on(
      table.email,
      table.createdAt,
    ),
    expiresAtIdx: index("invitations_expires_at_idx").on(table.expiresAt),
    acceptedAtIdx: index("invitations_accepted_at_idx").on(table.acceptedAt),
    revokedAtIdx: index("invitations_revoked_at_idx").on(table.revokedAt),
    createdAtIdx: index("invitations_created_at_idx").on(table.createdAt),
  }),
);

export const passwordResetTokens = mysqlTable(
  "password_reset_tokens",
  {
    hashedToken: varchar("hashed_token", { length: 255 }).primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    expiresAtIdx: index("password_reset_tokens_expires_at_idx").on(
      table.expiresAt,
    ),
    emailIdx: index("password_reset_tokens_email_idx").on(table.email),
  }),
);

export const emailChangeTokens = mysqlTable(
  "email_change_tokens",
  {
    hashedToken: varchar("hashed_token", { length: 255 }).primaryKey(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdUnique: uniqueIndex("email_change_tokens_user_id_unique").on(
      table.userId,
    ),
    expiresAtIdx: index("email_change_tokens_expires_at_idx").on(
      table.expiresAt,
    ),
  }),
);
