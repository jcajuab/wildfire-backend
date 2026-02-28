import { index, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import { displays } from "./display.sql";

export const displayStateTransitions = mysqlTable(
  "display_state_transitions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    displayId: varchar("display_id", { length: 36 })
      .notNull()
      .references(() => displays.id, { onDelete: "cascade" }),
    fromState: varchar("from_state", { length: 32 }).notNull(),
    toState: varchar("to_state", { length: 32 }).notNull(),
    reason: varchar("reason", { length: 255 }).notNull(),
    actorType: varchar("actor_type", { length: 16 }).notNull(),
    actorId: varchar("actor_id", { length: 36 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    displayIdIndex: index("display_state_transitions_display_id_idx").on(
      table.displayId,
    ),
    createdAtIndex: index("display_state_transitions_created_at_idx").on(
      table.createdAt,
    ),
  }),
);
