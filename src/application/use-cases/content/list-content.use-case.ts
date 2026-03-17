import {
  type ContentRecord,
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { type UserRepository } from "#/application/ports/rbac";
import { type ContentStatus, type ContentType } from "#/domain/content/content";
import { toContentView } from "./content-view";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const CONTENT_OPTIONS_LIMIT = 100;

export class ListContentUseCase {
  constructor(
    private readonly deps: {
      contentRepository: ContentRepository;
      userRepository: UserRepository;
      contentStorage: ContentStorage;
      thumbnailUrlExpiresInSeconds: number;
    },
  ) {}

  private async buildThumbnailUrl(
    record: ContentRecord,
  ): Promise<string | undefined> {
    if (!record.thumbnailKey) {
      return undefined;
    }

    try {
      return await this.deps.contentStorage.getPresignedDownloadUrl({
        key: record.thumbnailKey,
        expiresInSeconds: this.deps.thumbnailUrlExpiresInSeconds,
      });
    } catch {
      return undefined;
    }
  }

  async execute(input: {
    ownerId?: string;
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

    const { items, total } =
      input.ownerId && this.deps.contentRepository.listForOwner
        ? await this.deps.contentRepository.listForOwner({
            ownerId: input.ownerId,
            offset,
            limit: pageSize,
            status: input.status,
            type: input.type,
            search: input.search,
            sortBy: input.sortBy,
            sortDirection: input.sortDirection,
          })
        : await this.deps.contentRepository.list({
            offset,
            limit: pageSize,
            status: input.status,
            type: input.type,
            search: input.search,
            sortBy: input.sortBy,
            sortDirection: input.sortDirection,
          });

    const creatorIds = Array.from(new Set(items.map((item) => item.ownerId)));
    const creators = await this.deps.userRepository.findByIds(creatorIds);
    const creatorsById = new Map(creators.map((user) => [user.id, user]));

    const views = await Promise.all(
      items.map(async (item) => {
        const thumbnailUrl = await this.buildThumbnailUrl(item);
        return toContentView(
          item,
          creatorsById.get(item.ownerId)?.name ?? null,
          { thumbnailUrl },
        );
      }),
    );

    return {
      items: views,
      page,
      pageSize,
      total,
    };
  }
}

export class ListContentOptionsUseCase {
  constructor(
    private readonly deps: {
      contentRepository: ContentRepository;
    },
  ) {}

  async execute(input: {
    ownerId?: string;
    status?: ContentStatus;
    type?: ContentType;
    search?: string;
  }) {
    const result =
      input.ownerId && this.deps.contentRepository.listForOwner
        ? await this.deps.contentRepository.listForOwner({
            ownerId: input.ownerId,
            offset: 0,
            limit: CONTENT_OPTIONS_LIMIT,
            status: input.status,
            type: input.type,
            search: input.search,
            sortBy: "title",
            sortDirection: "asc",
          })
        : await this.deps.contentRepository.list({
            offset: 0,
            limit: CONTENT_OPTIONS_LIMIT,
            status: input.status,
            type: input.type,
            search: input.search,
            sortBy: "title",
            sortDirection: "asc",
          });

    return result.items.map((item) => ({
      id: item.id,
      title: item.title,
      type: item.type,
    }));
  }
}
