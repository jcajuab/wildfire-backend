import { index, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import { content } from "./content.sql";
import { displays } from "./displays.sql";
import { playlists } from "./playlist.sql";

export const schedules = mysqlTable(
  "schedules",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    displayId: varchar("display_id", { length: 36 })
      .notNull()
      .references(() => displays.id, { onDelete: "cascade" }),
    startDate: varchar("start_date", { length: 10 }).notNull(),
    endDate: varchar("end_date", { length: 10 }).notNull(),
    startTime: varchar("start_time", { length: 5 }).notNull(),
    endTime: varchar("end_time", { length: 5 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    displayIdIdx: index("schedules_display_id_idx").on(table.displayId),
    displayWindowIdx: index("schedules_display_window_idx").on(
      table.displayId,
      table.startDate,
      table.endDate,
    ),
  }),
);

export const schedulePlaylistTargets = mysqlTable(
  "schedule_playlist_targets",
  {
    scheduleId: varchar("schedule_id", { length: 36 })
      .primaryKey()
      .references(() => schedules.id, { onDelete: "cascade" }),
    playlistId: varchar("playlist_id", { length: 36 })
      .notNull()
      .references(() => playlists.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    playlistIdIdx: index("schedule_playlist_targets_playlist_id_idx").on(
      table.playlistId,
    ),
  }),
);

export const scheduleContentTargets = mysqlTable(
  "schedule_content_targets",
  {
    scheduleId: varchar("schedule_id", { length: 36 })
      .primaryKey()
      .references(() => schedules.id, { onDelete: "cascade" }),
    contentId: varchar("content_id", { length: 36 })
      .notNull()
      .references(() => content.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    contentIdIdx: index("schedule_content_targets_content_id_idx").on(
      table.contentId,
    ),
  }),
);
