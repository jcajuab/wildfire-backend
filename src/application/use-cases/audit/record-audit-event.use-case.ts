import { ValidationError } from "#/application/errors/validation";
import {
  type AuditActorType,
  type AuditEventRecord,
  type AuditEventRepository,
  type CreateAuditEventInput,
} from "#/application/ports/audit";

const trimToUndefined = (value: string | undefined, maxLength: number) => {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, maxLength);
};

const normalizeActorType = (
  actorType: AuditActorType | undefined,
): AuditActorType | undefined => {
  if (actorType === "user" || actorType === "display") {
    return actorType;
  }
  return undefined;
};

const normalizeStatus = (status: number) => {
  if (!Number.isFinite(status)) {
    throw new ValidationError("status must be a finite number");
  }

  const value = Math.trunc(status);
  if (value < 100 || value > 599) {
    throw new ValidationError("status must be between 100 and 599");
  }

  return value;
};

const SENSITIVE_METADATA_KEY =
  /(password|token|secret|authorization|api[-_]?key|cookie)/i;

const redactSensitiveValues = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveValues);
  }

  if (value != null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, childValue]) => [
        key,
        SENSITIVE_METADATA_KEY.test(key)
          ? "[REDACTED]"
          : redactSensitiveValues(childValue),
      ],
    );
    return Object.fromEntries(entries);
  }

  return value;
};

const normalizeMetadataJson = (raw: string | undefined): string | undefined => {
  const trimmed = trimToUndefined(raw, 16_384);
  if (!trimmed) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new ValidationError("metadataJson must be valid JSON");
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ValidationError("metadataJson must be a JSON object");
  }

  return JSON.stringify(redactSensitiveValues(parsed));
};

export class RecordAuditEventUseCase {
  constructor(
    private readonly deps: {
      auditEventRepository: AuditEventRepository;
    },
  ) {}

  async execute(input: CreateAuditEventInput): Promise<AuditEventRecord> {
    const action = trimToUndefined(input.action, 160);
    if (!action) {
      throw new ValidationError("action is required");
    }

    const method = trimToUndefined(input.method, 10)?.toUpperCase();
    if (!method) {
      throw new ValidationError("method is required");
    }

    const path = trimToUndefined(input.path, 255);
    if (!path) {
      throw new ValidationError("path is required");
    }

    const sanitized: CreateAuditEventInput = {
      occurredAt: input.occurredAt,
      requestId: trimToUndefined(input.requestId, 128),
      action,
      route: trimToUndefined(input.route, 255),
      method,
      path,
      status: normalizeStatus(input.status),
      actorId: trimToUndefined(input.actorId, 36),
      actorType: normalizeActorType(input.actorType),
      resourceId: trimToUndefined(input.resourceId, 36),
      resourceType: trimToUndefined(input.resourceType, 120),
      ipAddress: trimToUndefined(input.ipAddress, 64),
      userAgent: trimToUndefined(input.userAgent, 255),
      metadataJson: normalizeMetadataJson(input.metadataJson),
    };

    return this.deps.auditEventRepository.create(sanitized);
  }
}
