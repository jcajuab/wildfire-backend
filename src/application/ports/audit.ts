export type AuditActorType = "user" | "display";

export interface AuditLogRecord {
  id: string;
  occurredAt: string;
  requestId: string | null;
  action: string;
  route: string | null;
  method: string;
  path: string;
  status: number;
  actorId: string | null;
  actorType: AuditActorType | null;
  resourceId: string | null;
  resourceType: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadataJson: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
}

export interface CreateAuditLogInput {
  occurredAt?: Date;
  requestId?: string;
  action: string;
  route?: string;
  method: string;
  path: string;
  status: number;
  actorId?: string;
  actorType?: AuditActorType;
  resourceId?: string;
  resourceType?: string;
  ipAddress?: string;
  userAgent?: string;
  metadataJson?: string;
}

export interface ListAuditLogsQuery {
  offset: number;
  limit: number;
  from?: string;
  to?: string;
  actorId?: string;
  actorType?: AuditActorType;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  status?: number;
  requestId?: string;
}

export interface AuditLogRepository {
  create(input: CreateAuditLogInput): Promise<AuditLogRecord>;
  list(query: ListAuditLogsQuery): Promise<AuditLogRecord[]>;
  count(query: ListAuditLogsQuery): Promise<number>;
  deleteByRequestIdPrefix(prefix: string): Promise<number>;
}
