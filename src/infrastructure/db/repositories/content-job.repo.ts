import { eq } from "drizzle-orm";
import {
  type ContentIngestionJobRecord,
  type ContentIngestionJobRepository,
  type ContentIngestionJobStatus,
} from "#/application/ports/content-jobs";
import { db } from "#/infrastructure/db/client";
import { contentIngestionJobs } from "#/infrastructure/db/schema/content-job.sql";

const toRecord = (
  row: typeof contentIngestionJobs.$inferSelect,
): ContentIngestionJobRecord => ({
  id: row.id,
  contentId: row.contentId,
  operation: toOperation(row.operation),
  status: toStatus(row.status),
  errorMessage: row.errorMessage ?? null,
  createdById: row.createdById,
  createdAt:
    row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  updatedAt:
    row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  startedAt:
    row.startedAt instanceof Date
      ? row.startedAt.toISOString()
      : (row.startedAt ?? null),
  completedAt:
    row.completedAt instanceof Date
      ? row.completedAt.toISOString()
      : (row.completedAt ?? null),
});

const toOperation = (value: string): "UPLOAD" | "REPLACE" => {
  if (value === "UPLOAD" || value === "REPLACE") {
    return value;
  }
  throw new Error(`Invalid content ingestion job operation: ${value}`);
};

const toStatus = (value: string): ContentIngestionJobStatus => {
  if (
    value === "QUEUED" ||
    value === "PROCESSING" ||
    value === "SUCCEEDED" ||
    value === "FAILED"
  ) {
    return value;
  }
  throw new Error(`Invalid content ingestion job status: ${value}`);
};

export class ContentIngestionJobDbRepository
  implements ContentIngestionJobRepository
{
  async create(input: {
    id: string;
    contentId: string;
    operation: "UPLOAD" | "REPLACE";
    status: "QUEUED" | "PROCESSING" | "SUCCEEDED" | "FAILED";
    errorMessage?: string | null;
    createdById: string;
  }): Promise<ContentIngestionJobRecord> {
    const now = new Date();
    await db.insert(contentIngestionJobs).values({
      id: input.id,
      contentId: input.contentId,
      operation: input.operation,
      status: input.status,
      errorMessage: input.errorMessage ?? null,
      createdById: input.createdById,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    });

    const created = await this.findById(input.id);
    if (!created) {
      throw new Error("Failed to create content ingestion job");
    }
    return created;
  }

  async findById(id: string): Promise<ContentIngestionJobRecord | null> {
    const rows = await db
      .select()
      .from(contentIngestionJobs)
      .where(eq(contentIngestionJobs.id, id))
      .limit(1);
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  async update(
    id: string,
    input: {
      status?: "QUEUED" | "PROCESSING" | "SUCCEEDED" | "FAILED";
      errorMessage?: string | null;
      startedAt?: string | null;
      completedAt?: string | null;
    },
  ): Promise<ContentIngestionJobRecord | null> {
    const now = new Date();
    await db
      .update(contentIngestionJobs)
      .set({
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.errorMessage !== undefined
          ? { errorMessage: input.errorMessage }
          : {}),
        ...(input.startedAt !== undefined
          ? { startedAt: input.startedAt ? new Date(input.startedAt) : null }
          : {}),
        ...(input.completedAt !== undefined
          ? {
              completedAt: input.completedAt
                ? new Date(input.completedAt)
                : null,
            }
          : {}),
        updatedAt: now,
      })
      .where(eq(contentIngestionJobs.id, id));

    return this.findById(id);
  }
}
