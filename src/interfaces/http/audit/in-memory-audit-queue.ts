import { type CreateAuditEventInput } from "#/application/ports/audit";
import { type RecordAuditEventUseCase } from "#/application/use-cases/audit";
import { logger } from "#/infrastructure/observability/logger";

export type AuditQueueDropReason = "disabled" | "overflow";

export interface AuditQueueEnqueueResult {
  accepted: boolean;
  reason?: AuditQueueDropReason;
}

export interface AuditQueueStats {
  queued: number;
  dropped: number;
  flushed: number;
  failed: number;
}

export interface AuditEventQueue {
  enqueue(event: CreateAuditEventInput): AuditQueueEnqueueResult;
  flushNow(): Promise<void>;
  stop(): Promise<void>;
  getStats(): AuditQueueStats;
}

export interface InMemoryAuditQueueConfig {
  enabled: boolean;
  capacity: number;
  flushBatchSize: number;
  flushIntervalMs: number;
}

const sanitizeConfig = (
  config: InMemoryAuditQueueConfig,
): InMemoryAuditQueueConfig => ({
  enabled: config.enabled,
  capacity: Math.max(1, Math.trunc(config.capacity)),
  flushBatchSize: Math.max(1, Math.trunc(config.flushBatchSize)),
  flushIntervalMs: Math.max(1, Math.trunc(config.flushIntervalMs)),
});

export class InMemoryAuditQueue implements AuditEventQueue {
  private readonly config: InMemoryAuditQueueConfig;
  private readonly queue: CreateAuditEventInput[] = [];
  private readonly stats: AuditQueueStats = {
    queued: 0,
    dropped: 0,
    flushed: 0,
    failed: 0,
  };
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushPromise: Promise<void> | null = null;
  private isStopped = false;

  constructor(
    config: InMemoryAuditQueueConfig,
    private readonly deps: {
      recordAuditEvent: RecordAuditEventUseCase;
    },
  ) {
    this.config = sanitizeConfig(config);

    if (!this.config.enabled) {
      return;
    }

    this.timer = setInterval(() => {
      void this.flushNow();
    }, this.config.flushIntervalMs);
    this.timer.unref?.();
  }

  enqueue(event: CreateAuditEventInput): AuditQueueEnqueueResult {
    if (!this.config.enabled || this.isStopped) {
      return { accepted: false, reason: "disabled" };
    }

    if (this.queue.length >= this.config.capacity) {
      this.stats.dropped += 1;
      return { accepted: false, reason: "overflow" };
    }

    this.queue.push(event);
    this.stats.queued = this.queue.length;
    return { accepted: true };
  }

  async flushNow(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    if (this.flushPromise) {
      await this.flushPromise;
      return;
    }

    this.flushPromise = this.flushLoop().finally(() => {
      this.stats.queued = this.queue.length;
      this.flushPromise = null;
    });
    await this.flushPromise;
  }

  private async flushLoop(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.config.flushBatchSize);

      for (let index = 0; index < batch.length; index += 1) {
        const event = batch[index];
        if (!event) {
          continue;
        }

        try {
          await this.deps.recordAuditEvent.execute(event);
          this.stats.flushed += 1;
        } catch (error) {
          this.stats.failed += 1;
          const pendingBatch = batch.slice(index);
          this.queue.unshift(...pendingBatch);
          logger.warn(
            {
              err: error,
              requestId: event.requestId,
              action: event.action,
              pendingQueueSize: this.queue.length,
            },
            "audit queue flush failed",
          );
          return;
        }
      }
    }
  }

  async stop(): Promise<void> {
    if (this.isStopped) {
      return;
    }

    this.isStopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flushNow();
  }

  getStats(): AuditQueueStats {
    return {
      ...this.stats,
      queued: this.queue.length,
    };
  }
}
