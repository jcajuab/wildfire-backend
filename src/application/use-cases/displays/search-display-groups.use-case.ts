import {
  type DisplayGroupRecord,
  type DisplayGroupRepository,
} from "#/application/ports/displays";

export class SearchDisplayGroupsUseCase {
  constructor(
    private readonly deps: { displayGroupRepository: DisplayGroupRepository },
  ) {}

  async execute(input?: {
    page?: number;
    pageSize?: number;
    q?: string;
    displayId?: string;
    membership?: "member" | "non-member";
    sortBy?: "name" | "count";
    sortDirection?: "asc" | "desc";
  }): Promise<{
    items: DisplayGroupRecord[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(1, input?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, input?.pageSize ?? 20));
    const offset = (page - 1) * pageSize;
    const result = await this.deps.displayGroupRepository.listPage({
      offset,
      limit: pageSize,
      q: input?.q,
      displayId: input?.displayId,
      membership: input?.membership,
      sortBy: input?.sortBy,
      sortDirection: input?.sortDirection,
    });
    return {
      items: result.items,
      total: result.total,
      page,
      pageSize,
    };
  }
}
