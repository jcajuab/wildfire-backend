import { ValidationError } from "#/application/errors/validation";
import { type AuditLogRepository } from "#/application/ports/audit";

type FlushAuditLogsInput =
  | {
      mode: "olderThanDays";
      days: 7 | 30 | 90;
    }
  | {
      mode: "beforeDate";
      date: string;
    }
  | {
      mode: "all";
    };

const startOfDayUtc = (date: Date): Date =>
  new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );

const parseYyyyMmDd = (value: string): Date => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError("date must use YYYY-MM-DD format");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError("date must be a valid date");
  }
  if (parsed.toISOString().slice(0, 10) !== value) {
    throw new ValidationError("date must be a valid date");
  }
  return parsed;
};

export class FlushAuditLogsUseCase {
  constructor(
    private readonly deps: {
      auditLogRepository: AuditLogRepository;
      now?: () => Date;
    },
  ) {}

  async execute(input: FlushAuditLogsInput): Promise<{ deleted: number }> {
    if (input.mode === "all") {
      return { deleted: await this.deps.auditLogRepository.deleteAll() };
    }

    if (input.mode === "olderThanDays") {
      const now = startOfDayUtc(this.deps.now?.() ?? new Date());
      const cutoff = new Date(now);
      cutoff.setUTCDate(cutoff.getUTCDate() - input.days);
      return {
        deleted: await this.deps.auditLogRepository.deleteBefore(cutoff),
      };
    }

    const cutoff = parseYyyyMmDd(input.date);
    return {
      deleted: await this.deps.auditLogRepository.deleteBefore(cutoff),
    };
  }
}
