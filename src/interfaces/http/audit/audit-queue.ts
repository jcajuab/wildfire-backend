import { type CreateAuditEventInput } from "#/application/ports/audit";

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
