import { ValidationError } from "#/application/errors/validation";
import {
  type AuditActorType,
  type ListAuditEventsQuery,
} from "#/application/ports/audit";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const parseIsoDate = (value: string, name: string): Date => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`${name} must be a valid ISO datetime`);
  }

  return parsed;
};

const trimToUndefined = (value?: string) => {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseStatus = (value: number | undefined): number | undefined => {
  if (value == null) return undefined;
  if (!Number.isFinite(value)) {
    throw new ValidationError("status must be a finite number");
  }

  const normalized = Math.trunc(value);
  if (normalized < 100 || normalized > 599) {
    throw new ValidationError("status must be between 100 and 599");
  }

  return normalized;
};

const parseActorType = (
  value: string | undefined,
): AuditActorType | undefined => {
  if (!value) return undefined;
  if (value === "user" || value === "display") return value;
  throw new ValidationError("actorType must be one of: user, display");
};

export interface NormalizedAuditFilters {
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

export const normalizeAuditFilters = (input: {
  from?: string;
  to?: string;
  actorId?: string;
  actorType?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  status?: number;
  requestId?: string;
}): NormalizedAuditFilters => {
  const fromDate = input.from ? parseIsoDate(input.from, "from") : undefined;
  const toDate = input.to ? parseIsoDate(input.to, "to") : undefined;
  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    throw new ValidationError("from must be before or equal to to");
  }

  return {
    from: fromDate?.toISOString(),
    to: toDate?.toISOString(),
    actorId: trimToUndefined(input.actorId),
    actorType: parseActorType(trimToUndefined(input.actorType)),
    action: trimToUndefined(input.action),
    resourceType: trimToUndefined(input.resourceType),
    resourceId: trimToUndefined(input.resourceId),
    status: parseStatus(input.status),
    requestId: trimToUndefined(input.requestId),
  };
};

export const buildPaginatedAuditQuery = (
  input: {
    page?: number;
    pageSize?: number;
  } & NormalizedAuditFilters,
): {
  page: number;
  pageSize: number;
  query: ListAuditEventsQuery;
} => {
  const page = clamp(Math.trunc(input.page ?? 1), 1, Number.MAX_SAFE_INTEGER);
  const pageSize = clamp(Math.trunc(input.pageSize ?? 50), 1, 200);
  const offset = (page - 1) * pageSize;

  const query: ListAuditEventsQuery = {
    offset,
    limit: pageSize,
    from: input.from,
    to: input.to,
    actorId: input.actorId,
    actorType: input.actorType,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    status: input.status,
    requestId: input.requestId,
  };

  return {
    page,
    pageSize,
    query,
  };
};
