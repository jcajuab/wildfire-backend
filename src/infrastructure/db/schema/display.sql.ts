import {
  int,
  mysqlTable,
  primaryKey,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const displays = mysqlTable(
  "displays",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    displayFingerprint: varchar("display_fingerprint", { length: 255 }),
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
    displayFingerprintUnique: uniqueIndex(
      "displays_display_fingerprint_unique",
    ).on(table.displayFingerprint),
  }),
);

export const displayGroups = mysqlTable(
  "display_groups",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    colorIndex: int("color_index").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    nameUnique: unique("display_groups_name_unique").on(table.name),
  }),
);

export const displayGroupMemberships = mysqlTable(
  "display_group_memberships",
  {
    groupId: varchar("group_id", { length: 36 })
      .notNull()
      .references(() => displayGroups.id, { onDelete: "cascade" }),
    displayId: varchar("display_id", { length: 36 })
      .notNull()
      .references(() => displays.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.displayId] })],
);
