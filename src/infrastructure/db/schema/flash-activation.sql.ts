import {
  index,
  int,
  mysqlTable,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";
import { content } from "./content.sql";
import { displays } from "./display.sql";
import { users } from "./rbac.sql";

export const flashActivations = mysqlTable(
  "flash_activations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    contentId: varchar("content_id", { length: 36 })
      .notNull()
      .references(() => content.id, { onDelete: "restrict" }),
    targetDisplayId: varchar("target_display_id", { length: 36 })
      .notNull()
      .references(() => displays.id, { onDelete: "cascade" }),
    message: varchar("message", { length: 240 }).notNull(),
    tone: varchar("tone", { length: 16 }).notNull().default("INFO"),
    status: varchar("status", { length: 16 }).notNull().default("ACTIVE"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    endsAt: timestamp("ends_at").notNull(),
    stoppedAt: timestamp("stopped_at"),
    stoppedReason: varchar("stopped_reason", { length: 64 }),
    createdById: varchar("created_by_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    replacementCount: int("replacement_count").notNull().default(0),
  },
  (table) => ({
    statusIdx: index("flash_activations_status_idx").on(table.status),
    targetDisplayIdx: index("flash_activations_target_display_idx").on(
      table.targetDisplayId,
    ),
    endsAtIdx: index("flash_activations_ends_at_idx").on(table.endsAt),
  }),
);
