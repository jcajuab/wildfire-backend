import { type CreateAuditEventInput } from "#/application/ports/audit";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import { getRedisCommandClient } from "#/infrastructure/redis/client";
import {
  type AuditEventQueue,
  type AuditQueueEnqueueResult,
  type AuditQueueStats,
} from "#/interfaces/http/audit/audit-queue";

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

export class RedisAuditQueue implements AuditEventQueue {
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

  enqueue(event: CreateAuditEventInput): AuditQueueEnqueueResult {
    if (!this.config.enabled || this.isStopped) {
      return { accepted: false, reason: "disabled" };
    }

    this.stats.queued += 1;
    void this.pushToStream(event);

    return { accepted: true };
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

  private async pushToStream(event: CreateAuditEventInput): Promise<void> {
    try {
      const redis = await getRedisCommandClient();
      await redis.sendCommand([
        "XADD",
        this.config.streamName,
        "MAXLEN",
        "~",
        String(this.config.maxStreamLength),
        "*",
        "payload",
        JSON.stringify(event),
      ]);
      this.stats.flushed += 1;
      this.stats.queued = Math.max(0, this.stats.queued - 1);
    } catch (error) {
      this.stats.failed += 1;
      this.stats.dropped += 1;
      this.stats.queued = Math.max(0, this.stats.queued - 1);
      logger.warn(
        addErrorContext(
          {
            component: "audit",
            event: "audit.queue.enqueue_failed",
            action: event.action,
            requestId: event.requestId,
            streamName: this.config.streamName,
          },
          error,
        ),
        "audit queue enqueue failed",
      );
    }
  }
}
