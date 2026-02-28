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
    displaySlug: varchar("display_slug", { length: 120 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    displayFingerprint: varchar("display_fingerprint", { length: 255 }),
    registrationState: varchar("registration_state", { length: 32 })
      .notNull()
      .default("unpaired"),
    location: varchar("location", { length: 255 }),
    ipAddress: varchar("ip_address", { length: 128 }),
    macAddress: varchar("mac_address", { length: 64 }),
    screenWidth: int("screen_width"),
    screenHeight: int("screen_height"),
    displayOutput: varchar("display_output", { length: 64 })
      .notNull()
      .default("unknown"),
    orientation: varchar("orientation", { length: 16 }),
    lastSeenAt: timestamp("last_seen_at"),
    refreshNonce: int("refresh_nonce").notNull().default(0),
    registeredAt: timestamp("registered_at"),
    activatedAt: timestamp("activated_at"),
    unregisteredAt: timestamp("unregistered_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    slugUnique: uniqueIndex("displays_display_slug_unique").on(
      table.displaySlug,
    ),
    fingerprintOutputUnique: uniqueIndex(
      "displays_fingerprint_output_unique",
    ).on(table.displayFingerprint, table.displayOutput),
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
