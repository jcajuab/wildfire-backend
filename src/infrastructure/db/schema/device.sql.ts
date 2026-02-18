import {
  int,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const devices = mysqlTable(
  "devices",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    location: varchar("location", { length: 255 }),
    ipAddress: varchar("ip_address", { length: 128 }),
    macAddress: varchar("mac_address", { length: 64 }),
    screenWidth: int("screen_width"),
    screenHeight: int("screen_height"),
    outputType: varchar("output_type", { length: 64 }),
    orientation: varchar("orientation", { length: 16 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    identifierUnique: uniqueIndex("devices_identifier_unique").on(
      table.identifier,
    ),
  }),
);
