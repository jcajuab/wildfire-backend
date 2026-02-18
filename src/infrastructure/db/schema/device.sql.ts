import {
  int,
  mysqlTable,
  primaryKey,
  timestamp,
  unique,
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

export const deviceGroups = mysqlTable(
  "device_groups",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    nameUnique: unique("device_groups_name_unique").on(table.name),
  }),
);

export const deviceGroupDevices = mysqlTable(
  "device_group_devices",
  {
    groupId: varchar("group_id", { length: 36 })
      .notNull()
      .references(() => deviceGroups.id, { onDelete: "cascade" }),
    deviceId: varchar("device_id", { length: 36 })
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.deviceId] })],
);
