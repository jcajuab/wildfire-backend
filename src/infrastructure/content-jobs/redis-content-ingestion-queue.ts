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
            timeoutMs: this.config.enqueueTimeoutMs,
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
            baseDelayMs: this.config.enqueueBaseDelayMs,
            maxDelayMs: this.config.enqueueMaxDelayMs,
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
