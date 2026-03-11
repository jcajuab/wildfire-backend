import { type ContentRepository } from "#/application/ports/content";
import { type ContentIngestionJobRepository } from "#/application/ports/content-jobs";
import { env } from "#/env";
import { publishContentJobEvent } from "#/infrastructure/content-jobs/content-job-events";
import { db } from "#/infrastructure/db/client";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import { calculateExponentialDelayMs, sleep } from "#/shared/retry";
import {
  addToDlq,
  DLQ_REASON_INVALID_PAYLOAD,
  DLQ_REASON_PROCESSING_FAILED,
} from "./dlq-manager";
import { ackAndDeleteEntry } from "./entry-acknowledger";
import {
  type ContentIngestionWorkerConfig,
  contentIngestionContainer,
} from "./runtime";
import { type StreamEntry } from "./stream-transport";

const parseJobPayload = (
  payload: string,
): {
  jobId: string;
} | null => {
  try {
    const parsed = JSON.parse(payload) as {
      jobId?: unknown;
    };
    if (typeof parsed.jobId !== "string" || parsed.jobId.length === 0) {
      return null;
    }
    return { jobId: parsed.jobId };
  } catch {
    return null;
  }
};

const sanitizeErrorMessage = (message: string): string => {
  return message.replace(/[<>'"]/g, "").slice(0, 500);
};

const markJobAsFailed = async (
  jobId: string,
  errorMessage: string,
  repositories: {
    contentRepository: ContentRepository;
    contentIngestionJobRepository: ContentIngestionJobRepository;
  },
) => {
  const sanitizedErrorMessage = sanitizeErrorMessage(errorMessage);
  const job = await repositories.contentIngestionJobRepository.findById(jobId);

  if (!job) {
    return;
  }

  await db.transaction(async () => {
    try {
      await repositories.contentRepository.update(job.contentId, {
        status: "FAILED",
      });
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

    await repositories.contentIngestionJobRepository.update(job.id, {
      status: "FAILED",
      errorMessage: sanitizedErrorMessage,
      completedAt: new Date().toISOString(),
    });
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

export interface EntryProcessor {
  processEntry(input: { entry: StreamEntry }): Promise<void>;
}

export const createEntryProcessor = (input: {
  config: ContentIngestionWorkerConfig;
  processJob: (jobId: string) => Promise<void>;
}): EntryProcessor => {
  const processEntry = async (processInput: {
    entry: StreamEntry;
  }): Promise<void> => {
    const payload = parseJobPayload(processInput.entry.payload);
    if (!payload) {
      await addToDlq(input.config.streamDlqName, {
        entry: processInput.entry,
        reason: DLQ_REASON_INVALID_PAYLOAD,
      });
      await ackAndDeleteEntry(
        input.config.streamName,
        input.config.streamGroup,
        processInput.entry.id,
      );
      return;
    }

    for (let attempt = 1; attempt <= input.config.maxDeliveries; attempt += 1) {
      try {
        await input.processJob(payload.jobId);
        await ackAndDeleteEntry(
          input.config.streamName,
          input.config.streamGroup,
          processInput.entry.id,
        );
        return;
      } catch (error) {
        const isLastAttempt = attempt >= input.config.maxDeliveries;
        if (!isLastAttempt) {
          logger.warn(
            addErrorContext(
              {
                component: "content",
                event: "content.ingestion.worker.retry",
                streamName: input.config.streamName,
                streamGroup: input.config.streamGroup,
                consumerName: input.config.consumerName,
                streamEntryId: processInput.entry.id,
                jobId: payload.jobId,
                attempt,
                maxAttempts: input.config.maxDeliveries,
              },
              error,
            ),
            "content ingestion worker retrying stream entry",
          );
          await sleep(
            calculateExponentialDelayMs({
              attempt,
              baseDelayMs: env.WORKER_RETRY_BASE_DELAY_MS,
              maxDelayMs: env.WORKER_RETRY_MAX_DELAY_MS,
            }),
          );
          continue;
        }

        const errorMessage =
          error instanceof Error ? error.message : String(error);
        await markJobAsFailed(payload.jobId, errorMessage, {
          contentRepository:
            contentIngestionContainer.repositories.contentRepository,
          contentIngestionJobRepository:
            contentIngestionContainer.repositories
              .contentIngestionJobRepository,
        });

        await addToDlq(input.config.streamDlqName, {
          entry: processInput.entry,
          reason: DLQ_REASON_PROCESSING_FAILED,
          error: errorMessage,
        });
        await ackAndDeleteEntry(
          input.config.streamName,
          input.config.streamGroup,
          processInput.entry.id,
        );
        logger.error(
          addErrorContext(
            {
              component: "content",
              event: "content.ingestion.worker.dead_letter",
              streamName: input.config.streamName,
              streamGroup: input.config.streamGroup,
              consumerName: input.config.consumerName,
              streamEntryId: processInput.entry.id,
              jobId: payload.jobId,
              attempts: input.config.maxDeliveries,
            },
            error,
          ),
          "content ingestion worker moved entry to DLQ",
        );
        return;
      }
    }
  };

  return {
    processEntry,
  };
};
