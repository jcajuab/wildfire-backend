import { type CreateAuditLogInput } from "#/application/ports/audit";
import { env } from "#/env";
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
import { calculateExponentialDelayMs, sleep } from "#/shared/retry";

export interface RedisAuditQueueConfig {
  enabled: boolean;
  maxStreamLength: number;
  streamName: string;
}

const sanitizeConfig = (
  config: RedisAuditQueueConfig,
): RedisAuditQueueConfig => ({
  enabled: config.enabled,
  maxStreamLength: Math.max(1, Math.trunc(config.maxStreamLength)),
  streamName: config.streamName.trim(),
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

  async flushNow(): Promise<void> {
    return;
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
    const maxAttempts = Math.max(
      1,
      Math.trunc(env.AUDIT_QUEUE_ENQUEUE_MAX_ATTEMPTS),
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
            JSON.stringify(event),
          ],
          {
            timeoutMs: env.AUDIT_QUEUE_ENQUEUE_TIMEOUT_MS,
            operationName: "audit queue push",
          },
        );
        this.stats.flushed += 1;
        this.stats.queued = Math.max(0, this.stats.queued - 1);
        return;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) {
          break;
        }

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

        await sleep(
          calculateExponentialDelayMs({
            attempt,
            baseDelayMs: env.AUDIT_QUEUE_ENQUEUE_BASE_DELAY_MS,
            maxDelayMs: env.AUDIT_QUEUE_ENQUEUE_MAX_DELAY_MS,
          }),
        );
      }
    }

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
        lastError,
      ),
      "audit queue enqueue failed",
    );
    throw lastError ?? new Error("Unknown error while enqueuing audit event");
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
