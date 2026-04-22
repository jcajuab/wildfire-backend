import { type CreateAuditLogInput } from "#/application/ports/audit";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";
import {
  type AuditLogQueue,
  type AuditQueueEnqueueResult,
  type AuditQueueStats,
} from "#/interfaces/http/audit/audit-queue";
import { retryWithBackoff } from "#/shared/retry";

export interface RedisAuditQueueConfig {
  enabled: boolean;
  maxStreamLength: number;
  streamName: string;
  enqueueMaxAttempts: number;
  enqueueBaseDelayMs: number;
  enqueueMaxDelayMs: number;
  enqueueTimeoutMs: number;
}

const sanitizeConfig = (
  config: RedisAuditQueueConfig,
): RedisAuditQueueConfig => ({
  enabled: config.enabled,
  maxStreamLength: Math.max(1, Math.trunc(config.maxStreamLength)),
  streamName: config.streamName.trim(),
  enqueueMaxAttempts: Math.max(1, Math.trunc(config.enqueueMaxAttempts)),
  enqueueBaseDelayMs: Math.max(0, Math.trunc(config.enqueueBaseDelayMs)),
  enqueueMaxDelayMs: Math.max(0, Math.trunc(config.enqueueMaxDelayMs)),
  enqueueTimeoutMs: Math.max(1, Math.trunc(config.enqueueTimeoutMs)),
});

export class RedisAuditQueue implements AuditLogQueue {
  private readonly config: RedisAuditQueueConfig;
  private readonly stats: AuditQueueStats = {
    queued: 0,
    dropped: 0,
    flushed: 0,
    failed: 0,
  };
  private isStopped = false;

  constructor(config: RedisAuditQueueConfig) {
    this.config = sanitizeConfig(config);
  }

  async stop(): Promise<void> {
    this.isStopped = true;
  }

  getStats(): AuditQueueStats {
    return {
      ...this.stats,
    };
  }

  private async pushToStream(event: CreateAuditLogInput): Promise<void> {
    const maxAttempts = this.config.enqueueMaxAttempts;

    try {
      await retryWithBackoff(
        async () => {
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
              JSON.stringify(event),
            ],
            {
              timeoutMs: this.config.enqueueTimeoutMs,
              operationName: "audit queue push",
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
                  component: "audit",
                  event: "audit.queue.retrying",
                  action: event.action,
                  requestId: event.requestId,
                  attempt,
                  maxAttempts,
                  streamName: this.config.streamName,
                },
                error,
              ),
              "audit queue retrying enqueue",
            );
          },
        },
      );
      this.stats.flushed += 1;
      this.stats.queued = Math.max(0, this.stats.queued - 1);
    } catch (error) {
      this.stats.failed += 1;
      this.stats.dropped += 1;
      this.stats.queued = Math.max(0, this.stats.queued - 1);
      logger.error(
        addErrorContext(
          {
            component: "audit",
            event: "audit.queue.enqueue_failed",
            action: event.action,
            requestId: event.requestId,
            streamName: this.config.streamName,
            maxAttempts,
          },
          error,
        ),
        "audit queue enqueue failed",
      );
      throw error;
    }
  }

  async enqueue(event: CreateAuditLogInput): Promise<AuditQueueEnqueueResult> {
    if (!this.config.enabled || this.isStopped) {
      return { accepted: false, reason: "disabled" };
    }

    this.stats.queued += 1;

    try {
      await this.pushToStream(event);
      return { accepted: true };
    } catch (error) {
      return {
        accepted: false,
        reason: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
