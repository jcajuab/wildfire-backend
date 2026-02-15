import { type AuditEventRepository } from "#/application/ports/audit";
import { normalizeAuditFilters } from "./query-normalization";

export class ExportLimitExceededError extends Error {
  constructor(public readonly limit: number) {
    super(`Export limit exceeded. Max rows: ${limit}`);
    this.name = "ExportLimitExceededError";
  }
}

export class ExportAuditEventsUseCase {
  private readonly maxRows: number;
  private readonly chunkSize: number;

  constructor(
    private readonly deps: {
      auditEventRepository: AuditEventRepository;
      maxRows: number;
      chunkSize?: number;
    },
  ) {
    this.maxRows = Math.max(1, Math.trunc(deps.maxRows));
    this.chunkSize = Math.max(
      1,
      Math.min(Math.trunc(deps.chunkSize ?? 1000), this.maxRows),
    );
  }

  async *execute(input: {
    from?: string;
    to?: string;
    actorId?: string;
    actorType?: string;
    action?: string;
    resourceType?: string;
    resourceId?: string;
    status?: number;
    requestId?: string;
  }) {
    const filters = normalizeAuditFilters(input);
    const baseQuery = {
      ...filters,
      offset: 0,
      limit: this.chunkSize,
    };

    const total = await this.deps.auditEventRepository.count(baseQuery);
    if (total > this.maxRows) {
      throw new ExportLimitExceededError(this.maxRows);
    }

    let offset = 0;
    while (offset < total) {
      const rows = await this.deps.auditEventRepository.list({
        ...baseQuery,
        offset,
      });
      if (rows.length === 0) {
        return;
      }

      yield rows;
      offset += rows.length;
    }
  }
}
