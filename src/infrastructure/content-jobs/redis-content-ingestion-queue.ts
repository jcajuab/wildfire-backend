import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";
import { retryWithBackoff } from "#/shared/retry";

export interface RedisContentIngestionQueueConfig {
  enabled: boolean;
  maxStreamLength: number;
  streamName: string;
  enqueueMaxAttempts: number;
  enqueueBaseDelayMs: number;
  enqueueMaxDelayMs: number;
  enqueueTimeoutMs: number;
}

const sanitizeConfig = (
  config: RedisContentIngestionQueueConfig,
): RedisContentIngestionQueueConfig => ({
  enabled: config.enabled,
  maxStreamLength: Math.max(1, Math.trunc(config.maxStreamLength)),
  streamName: config.streamName.trim(),
  enqueueMaxAttempts: Math.max(1, Math.trunc(config.enqueueMaxAttempts)),
  enqueueBaseDelayMs: Math.max(0, Math.trunc(config.enqueueBaseDelayMs)),
  enqueueMaxDelayMs: Math.max(0, Math.trunc(config.enqueueMaxDelayMs)),
  enqueueTimeoutMs: Math.max(1, Math.trunc(config.enqueueTimeoutMs)),
});

export class RedisContentIngestionQueue {
  private readonly config: RedisContentIngestionQueueConfig;

  constructor(config: RedisContentIngestionQueueConfig) {
    this.config = sanitizeConfig(config);
  }

  async enqueue(input: { jobId: string }): Promise<void> {
    if (!this.config.enabled) {
      throw new Error("Content ingestion queue is disabled");
    }

    const maxAttempts = this.config.enqueueMaxAttempts;
    const threshold = this.config.maxStreamLength;
    const streamName = this.config.streamName;

    try {
      await retryWithBackoff(
        async () => {
          const redis = await getRedisCommandClient();
          await executeRedisCommand(
            (signal) =>
              redis.withAbortSignal(signal).xAdd(
                streamName,
                "*",
                { payload: JSON.stringify({ jobId: input.jobId }) },
                {
                  TRIM: {
                    strategy: "MAXLEN",
                    strategyModifier: "~",
                    threshold,
                  },
                },
              ),
            {
              timeoutMs: this.config.enqueueTimeoutMs,
              operationName: "content ingestion queue push",
            },
          );
        },
        {
          maxAttempts,
          baseDelayMs: this.config.enqueueBaseDelayMs,
          maxDelayMs: this.config.enqueueMaxDelayMs,
          onRetry: (error, attempt) => {
            logger.warn(
              addErrorContext(
                {
                  component: "content",
                  event: "content.ingestion.queue.retrying",
                  streamName: this.config.streamName,
                  jobId: input.jobId,
                  attempt,
                  maxAttempts,
                },
                error,
              ),
              "content ingestion queue retrying",
            );
          },
        },
      );
    } catch (error) {
      logger.error(
        addErrorContext(
          {
            component: "content",
            event: "content.ingestion.queue.enqueue_failed",
            streamName: this.config.streamName,
            jobId: input.jobId,
            maxAttempts,
          },
          error,
        ),
        "content ingestion enqueue failed",
      );
      throw error;
    }
  }
}
