import { type AuditEventRepository } from "#/application/ports/audit";
import {
  buildPaginatedAuditQuery,
  normalizeAuditFilters,
} from "./query-normalization";

export class ListAuditEventsUseCase {
  constructor(
    private readonly deps: {
      auditEventRepository: AuditEventRepository;
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
      this.deps.auditEventRepository.list(query),
      this.deps.auditEventRepository.count(query),
    ]);

    return {
      items,
      page,
      pageSize,
      total,
    };
  }
}
