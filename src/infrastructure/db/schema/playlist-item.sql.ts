import { int, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { content } from "./content.sql";
import { playlists } from "./playlist.sql";

export const playlistItems = mysqlTable(
  "playlist_items",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    playlistId: varchar("playlist_id", { length: 36 })
      .notNull()
      .references(() => playlists.id, { onDelete: "cascade" }),
    contentId: varchar("content_id", { length: 36 })
      .notNull()
      .references(() => content.id, { onDelete: "restrict" }),
    sequence: int("sequence").notNull(),
    duration: int("duration").notNull(),
  },
  (table) => [
    uniqueIndex("playlist_items_playlist_id_sequence_unique").on(
      table.playlistId,
      table.sequence,
    ),
  ],
);
