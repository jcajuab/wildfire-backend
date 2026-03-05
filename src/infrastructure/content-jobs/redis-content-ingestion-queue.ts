import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";
import { calculateExponentialDelayMs, sleep } from "#/shared/retry";

export interface RedisContentIngestionQueueConfig {
  enabled: boolean;
  maxStreamLength: number;
  streamName: string;
}

const sanitizeConfig = (
  config: RedisContentIngestionQueueConfig,
): RedisContentIngestionQueueConfig => ({
  enabled: config.enabled,
  maxStreamLength: Math.max(1, Math.trunc(config.maxStreamLength)),
  streamName: config.streamName.trim(),
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

    const maxAttempts = Math.max(
      1,
      Math.trunc(env.CONTENT_INGEST_QUEUE_ENQUEUE_MAX_ATTEMPTS),
    );

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const redis = await getRedisCommandClient();
        await executeRedisCommand<void>(
          redis,
          [
            "XADD",
            this.config.streamName,
            "MAXLEN",
            "~",
            String(this.config.maxStreamLength),
            "*",
            "payload",
            JSON.stringify({ jobId: input.jobId }),
          ],
          {
            timeoutMs: env.CONTENT_INGEST_QUEUE_ENQUEUE_TIMEOUT_MS,
            operationName: "content ingestion queue push",
          },
        );
        return;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) {
          break;
        }

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

        await sleep(
          calculateExponentialDelayMs({
            attempt,
            baseDelayMs: env.CONTENT_INGEST_QUEUE_ENQUEUE_BASE_DELAY_MS,
            maxDelayMs: env.CONTENT_INGEST_QUEUE_ENQUEUE_MAX_DELAY_MS,
          }),
        );
      }
    }

    logger.error(
      addErrorContext(
        {
          component: "content",
          event: "content.ingestion.queue.enqueue_failed",
          streamName: this.config.streamName,
          jobId: input.jobId,
          maxAttempts,
        },
        lastError,
      ),
      "content ingestion enqueue failed",
    );
    throw lastError ?? new Error("Content ingestion queue enqueue failed");
  }
}
