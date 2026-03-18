import { mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";
import { users } from "./rbac.sql";

export const passwordHashes = mysqlTable("password_hashes", {
  userId: varchar("user_id", { length: 36 })
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
