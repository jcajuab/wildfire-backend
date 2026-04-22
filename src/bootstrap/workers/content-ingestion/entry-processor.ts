import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import { calculateExponentialDelayMs, sleep } from "#/shared/retry";
import {
  addToDlq,
  DLQ_REASON_INVALID_PAYLOAD,
  DLQ_REASON_PROCESSING_FAILED,
} from "./dlq-manager";
import { ackAndDeleteEntry } from "./entry-acknowledger";
import { markJobFailed } from "./job-state";
import { type ContentIngestionWorkerConfig } from "./runtime";
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
        await markJobFailed(payload.jobId, errorMessage);

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
