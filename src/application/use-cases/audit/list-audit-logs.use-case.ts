import { type AuditLogRepository } from "#/application/ports/audit";
import {
  buildPaginatedAuditQuery,
  normalizeAuditFilters,
} from "./query-normalization";

export class ListAuditLogsUseCase {
  constructor(
    private readonly deps: {
      auditLogRepository: AuditLogRepository;
    },
  ) {}

  async execute(input: {
    page?: number;
    pageSize?: number;
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
    const { page, pageSize, query } = buildPaginatedAuditQuery({
      page: input.page,
      pageSize: input.pageSize,
      ...filters,
    });

    const [items, total] = await Promise.all([
      this.deps.auditLogRepository.list(query),
      this.deps.auditLogRepository.count(query),
    ]);

    return {
      items,
      page,
      pageSize,
      total,
    };
  }
}
