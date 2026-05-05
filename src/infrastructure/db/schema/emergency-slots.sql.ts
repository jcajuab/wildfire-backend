import {
  index,
  mysqlTable,
  timestamp,
  tinyint,
  varchar,
} from "drizzle-orm/mysql-core";
import { content } from "./content.sql";

export const emergencySlots = mysqlTable(
  "emergency_slots",
  {
    slotIndex: tinyint("slot_index").primaryKey(),
    label: varchar("label", { length: 64 }).notNull(),
    contentId: varchar("content_id", { length: 36 }).references(
      () => content.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (table) => ({
    contentIdIdx: index("emergency_slots_content_id_idx").on(table.contentId),
  }),
);
