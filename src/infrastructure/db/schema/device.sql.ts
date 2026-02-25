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
  "displays",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    deviceFingerprint: varchar("device_fingerprint", { length: 255 }),
    location: varchar("location", { length: 255 }),
    ipAddress: varchar("ip_address", { length: 128 }),
    macAddress: varchar("mac_address", { length: 64 }),
    screenWidth: int("screen_width"),
    screenHeight: int("screen_height"),
    outputType: varchar("output_type", { length: 64 }),
    orientation: varchar("orientation", { length: 16 }),
    lastSeenAt: timestamp("last_seen_at"),
    refreshNonce: int("refresh_nonce").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    identifierUnique: uniqueIndex("displays_identifier_unique").on(
      table.identifier,
    ),
    deviceFingerprintUnique: uniqueIndex(
      "displays_device_fingerprint_unique",
    ).on(table.deviceFingerprint),
  }),
);

export const deviceGroups = mysqlTable(
  "device_groups",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    colorIndex: int("color_index").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    nameUnique: unique("device_groups_name_unique").on(table.name),
  }),
);

export const deviceGroupMemberships = mysqlTable(
  "device_group_memberships",
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
