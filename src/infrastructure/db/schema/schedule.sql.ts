import {
  boolean,
  index,
  int,
  mysqlTable,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";
import { devices } from "./device.sql";
import { playlists } from "./playlist.sql";

export const schedules = mysqlTable(
  "schedules",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    playlistId: varchar("playlist_id", { length: 36 })
      .notNull()
      .references(() => playlists.id, { onDelete: "restrict" }),
    deviceId: varchar("device_id", { length: 36 })
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
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
    deviceIdIdx: index("schedules_device_id_idx").on(table.deviceId),
    playlistIdIdx: index("schedules_playlist_id_idx").on(table.playlistId),
  }),
);
