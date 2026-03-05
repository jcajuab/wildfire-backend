import { type CreateAuditEventInput } from "#/application/ports/audit";

export type AuditQueueDropReason = "disabled" | "overflow";
export type AuditQueueFailureReason = "failed";

export type AuditQueueResultReason =
  | AuditQueueDropReason
  | AuditQueueFailureReason;

export interface AuditQueueEnqueueResult {
  accepted: boolean;
  reason?: AuditQueueResultReason;
  error?: string;
}

export interface AuditQueueStats {
  queued: number;
  dropped: number;
  flushed: number;
  failed: number;
}

export interface AuditEventQueue {
  enqueue(event: CreateAuditEventInput): Promise<AuditQueueEnqueueResult>;
  flushNow(): Promise<void>;
  stop(): Promise<void>;
  getStats(): AuditQueueStats;
}
