import {
  type DisplayRepository,
  type DisplayStatus,
} from "#/application/ports/displays";
import { listDisplaysWithFallback, withTelemetry } from "./shared";

export class ListDisplaysUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      scheduleRepository?: unknown;
      playlistRepository?: unknown;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input?: {
    page?: number;
    pageSize?: number;
    q?: string;
    status?: DisplayStatus;
    output?: string;
    groupIds?: string[];
    membership?: "ungrouped" | "any";
    sortBy?: "name" | "status" | "groupCount";
    sortDirection?: "asc" | "desc";
  }) {
    const page = Math.max(1, input?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, input?.pageSize ?? 20));
    const offset = (page - 1) * pageSize;
    const paged = await listDisplaysWithFallback({
      displayRepository: this.deps.displayRepository,
      offset,
      limit: pageSize,
      q: input?.q,
      status: input?.status,
      output: input?.output,
      groupIds: input?.groupIds,
      membership: input?.membership,
      sortBy: input?.sortBy,
      sortDirection: input?.sortDirection,
    });
    const withStatus = paged.items.map(withTelemetry);
    return {
      items: withStatus,
      total: paged.total,
      page,
      pageSize,
    };
  }
}
