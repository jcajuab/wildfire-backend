import {
  boolean,
  index,
  int,
  mysqlEnum,
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
    slug: varchar("slug", { length: 120 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    fingerprint: varchar("fingerprint", { length: 255 }),
    output: varchar("output", { length: 64 }).notNull().default("unknown"),
    location: varchar("location", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    slugUnique: uniqueIndex("displays_slug_unique").on(table.slug),
    fingerprintOutputUnique: uniqueIndex(
      "displays_fingerprint_output_unique",
    ).on(table.fingerprint, table.output),
    createdAtIndex: index("displays_created_at_idx").on(table.createdAt),
  }),
);

export const displayRuntimeStates = mysqlTable(
  "display_runtime_states",
  {
    displayId: varchar("display_id", { length: 36 })
      .primaryKey()
      .references(() => displays.id, { onDelete: "cascade" }),
    status: mysqlEnum("status", ["PROCESSING", "READY", "LIVE", "DOWN"])
      .notNull()
      .default("PROCESSING"),
    ipAddress: varchar("ip_address", { length: 128 }),
    macAddress: varchar("mac_address", { length: 64 }),
    screenWidth: int("screen_width"),
    screenHeight: int("screen_height"),
    orientation: mysqlEnum("orientation", ["LANDSCAPE", "PORTRAIT"]),
    lastSeenAt: timestamp("last_seen_at"),
    refreshNonce: int("refresh_nonce").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    statusIndex: index("display_runtime_states_status_idx").on(table.status),
    lastSeenAtIndex: index("display_runtime_states_last_seen_at_idx").on(
      table.lastSeenAt,
    ),
    updatedAtIndex: index("display_runtime_states_updated_at_idx").on(
      table.updatedAt,
    ),
  }),
);

export const displayEmergencyStates = mysqlTable(
  "display_emergency_states",
  {
    displayId: varchar("display_id", { length: 36 })
      .primaryKey()
      .references(() => displays.id, { onDelete: "cascade" }),
    emergencyContentId: varchar("emergency_content_id", {
      length: 36,
    }).references(() => content.id, { onDelete: "set null" }),
    localEmergencyActive: boolean("local_emergency_active")
      .notNull()
      .default(false),
    localEmergencyStartedAt: timestamp("local_emergency_started_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    emergencyContentIdIndex: index(
      "display_emergency_states_emergency_content_id_idx",
    ).on(table.emergencyContentId),
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

export const displayGroupMembers = mysqlTable(
  "display_group_members",
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
