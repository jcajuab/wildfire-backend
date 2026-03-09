import {
  index,
  mysqlEnum,
  mysqlTable,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";
import { content } from "./content.sql";
import { users } from "./rbac.sql";

export const contentIngestionJobs = mysqlTable(
  "content_ingestion_jobs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    contentId: varchar("content_id", { length: 36 })
      .notNull()
      .references(() => content.id, { onDelete: "cascade" }),
    operation: mysqlEnum("operation", ["UPLOAD", "REPLACE"]).notNull(),
    status: mysqlEnum("status", ["QUEUED", "PROCESSING", "SUCCEEDED", "FAILED"])
      .notNull()
      .default("QUEUED"),
    errorMessage: varchar("error_message", { length: 1024 }),
    ownerId: varchar("owner_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
  },
  (table) => ({
    contentIdIndex: index("content_ingestion_jobs_content_id_idx").on(
      table.contentId,
    ),
    statusIndex: index("content_ingestion_jobs_status_idx").on(table.status),
    createdAtIndex: index("content_ingestion_jobs_created_at_idx").on(
      table.createdAt,
    ),
  }),
);
