import { type ContentRepository } from "#/application/ports/content";
import { type UserRepository } from "#/application/ports/rbac";
import { type ContentStatus, type ContentType } from "#/domain/content/content";
import { toContentView } from "./content-view";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export class ListContentUseCase {
  constructor(
    private readonly deps: {
      contentRepository: ContentRepository;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input: {
    page?: number;
    pageSize?: number;
    status?: ContentStatus;
    type?: ContentType;
    search?: string;
    sortBy?: "createdAt" | "title" | "fileSize" | "type";
    sortDirection?: "asc" | "desc";
  }) {
    const page = clamp(Math.trunc(input.page ?? 1), 1, Number.MAX_SAFE_INTEGER);
    const pageSize = clamp(Math.trunc(input.pageSize ?? 20), 1, 100);
    const offset = (page - 1) * pageSize;

    const { items, total } = await this.deps.contentRepository.list({
      offset,
      limit: pageSize,
      status: input.status,
      type: input.type,
      search: input.search,
      sortBy: input.sortBy,
      sortDirection: input.sortDirection,
    });

    const creatorIds = Array.from(
      new Set(items.map((item) => item.createdById)),
    );
    const creators = await this.deps.userRepository.findByIds(creatorIds);
    const creatorsById = new Map(creators.map((user) => [user.id, user]));

    return {
      items: items.map((item) =>
        toContentView(item, creatorsById.get(item.createdById)?.name ?? null),
      ),
      page,
      pageSize,
      total,
    };
  }
}
