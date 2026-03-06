import {
  boolean,
  index,
  int,
  mysqlTable,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";
import { content } from "./content.sql";
import { displays } from "./displays.sql";
import { playlists } from "./playlist.sql";

export const schedules = mysqlTable(
  "schedules",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    kind: varchar("kind", { length: 16 }).notNull().default("PLAYLIST"),
    playlistId: varchar("playlist_id", { length: 36 }).references(
      () => playlists.id,
      { onDelete: "restrict" },
    ),
    contentId: varchar("content_id", { length: 36 }).references(
      () => content.id,
      { onDelete: "restrict" },
    ),
    displayId: varchar("display_id", { length: 36 })
      .notNull()
      .references(() => displays.id, { onDelete: "cascade" }),
    startDate: varchar("start_date", { length: 10 }).notNull(),
    endDate: varchar("end_date", { length: 10 }).notNull(),
    startTime: varchar("start_time", { length: 5 }).notNull(),
    endTime: varchar("end_time", { length: 5 }).notNull(),
    priority: int("priority").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    displayIdIdx: index("schedules_display_id_idx").on(table.displayId),
    playlistIdIdx: index("schedules_playlist_id_idx").on(table.playlistId),
    contentIdIdx: index("schedules_content_id_idx").on(table.contentId),
    displayKindIdx: index("schedules_display_kind_idx").on(
      table.displayId,
      table.kind,
    ),
  }),
);
