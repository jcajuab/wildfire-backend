import {
  boolean,
  int,
  mysqlTable,
  primaryKey,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { content } from "./content.sql";

export const displays = mysqlTable(
  "displays",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    displaySlug: varchar("display_slug", { length: 120 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    displayFingerprint: varchar("display_fingerprint", { length: 255 }),
    status: varchar("status", { length: 16 }).notNull().default("PROCESSING"),
    location: varchar("location", { length: 255 }),
    ipAddress: varchar("ip_address", { length: 128 }),
    macAddress: varchar("mac_address", { length: 64 }),
    screenWidth: int("screen_width"),
    screenHeight: int("screen_height"),
    displayOutput: varchar("display_output", { length: 64 })
      .notNull()
      .default("unknown"),
    orientation: varchar("orientation", { length: 16 }),
    emergencyContentId: varchar("emergency_content_id", {
      length: 36,
    }).references(() => content.id, { onDelete: "set null" }),
    localEmergencyActive: boolean("local_emergency_active")
      .notNull()
      .default(false),
    localEmergencyStartedAt: timestamp("local_emergency_started_at"),
    lastSeenAt: timestamp("last_seen_at"),
    refreshNonce: int("refresh_nonce").notNull().default(0),
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
