import { eq } from "drizzle-orm";
import { type ContentIngestionJobRecord } from "#/application/ports/content-jobs";
import { publishContentJobEvent } from "#/infrastructure/content-jobs/content-job-events";
import { db } from "#/infrastructure/db/client";
import { content } from "#/infrastructure/db/schema/content.sql";
import { contentIngestionJobs } from "#/infrastructure/db/schema/content-job.sql";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import { contentIngestionContainer } from "./runtime";

export const sanitizeErrorMessage = (message: string): string => {
  return message.replace(/[<>'"]/g, "").slice(0, 500);
};

export const markJobProcessing = async (
  job: ContentIngestionJobRecord,
): Promise<string> => {
  const jobRepository =
    contentIngestionContainer.repositories.contentIngestionJobRepository;
  const startedAt = new Date().toISOString();
  await jobRepository.update(job.id, {
    status: "PROCESSING",
    errorMessage: null,
    startedAt,
    completedAt: null,
  });
  publishContentJobEvent({
    type: "processing",
    jobId: job.id,
    contentId: job.contentId,
    timestamp: startedAt,
    status: "PROCESSING",
    message: "Content ingestion started",
  });
  return startedAt;
};

export const markJobSucceeded = async (
  job: ContentIngestionJobRecord,
): Promise<void> => {
  const jobRepository =
    contentIngestionContainer.repositories.contentIngestionJobRepository;
  const completedAt = new Date().toISOString();
  await jobRepository.update(job.id, {
    status: "SUCCEEDED",
    errorMessage: null,
    completedAt,
  });
  publishContentJobEvent({
    type: "succeeded",
    jobId: job.id,
    contentId: job.contentId,
    timestamp: completedAt,
    status: "SUCCEEDED",
    message: "Content ingestion completed",
  });
};

export const markJobFailed = async (
  jobId: string,
  errorMessage: string,
): Promise<void> => {
  const jobRepository =
    contentIngestionContainer.repositories.contentIngestionJobRepository;
  const sanitizedErrorMessage = sanitizeErrorMessage(errorMessage);
  const job = await jobRepository.findById(jobId);

  if (!job) {
    return;
  }

  await db.transaction(async (tx) => {
    try {
      await tx
        .update(content)
        .set({ status: "FAILED", updatedAt: new Date() })
        .where(eq(content.id, job.contentId));
    } catch (error) {
      logger.error(
        addErrorContext(
          {
            component: "content",
            event: "content.ingestion.mark_failed.content_update_error",
            jobId: job.id,
            contentId: job.contentId,
          },
          error,
        ),
        "Failed to update content status to FAILED",
      );
      throw error;
    }

    const now = new Date();
    await tx
      .update(contentIngestionJobs)
      .set({
        status: "FAILED",
        errorMessage: sanitizedErrorMessage,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(contentIngestionJobs.id, job.id));
  });

  publishContentJobEvent({
    type: "failed",
    jobId: job.id,
    contentId: job.contentId,
    timestamp: new Date().toISOString(),
    status: "FAILED",
    errorMessage: sanitizedErrorMessage,
    message: "Content ingestion failed",
  });
};
