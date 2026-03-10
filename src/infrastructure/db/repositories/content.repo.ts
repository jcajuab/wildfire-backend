import {
  type ContentRecord,
  type ContentRepository,
} from "#/application/ports/content";
import { ContentQueryRepository } from "./content.repo.queries";
import { type ContentUpdateInput } from "./content.repo.shared";
import { ContentWriteRepository } from "./content.repo.writes";

export class ContentDbRepository implements ContentRepository {
  private readonly queries = new ContentQueryRepository();
  private readonly writes = new ContentWriteRepository(this.queries);

  async create(
    input: Omit<ContentRecord, "createdAt">,
  ): Promise<ContentRecord> {
    return this.writes.create(input);
  }

  async findById(id: string): Promise<ContentRecord | null> {
    return this.queries.findById(id);
  }

  async findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<ContentRecord | null> {
    return this.queries.findByIdForOwner(id, ownerId);
  }

  async findByIds(ids: string[]): Promise<ContentRecord[]> {
    return this.queries.findByIds(ids);
  }

  async findByIdsForOwner(
    ids: string[],
    ownerId: string,
  ): Promise<ContentRecord[]> {
    return this.queries.findByIdsForOwner(ids, ownerId);
  }

  async list(input: {
    offset: number;
    limit: number;
    parentId?: string;
    status?: ContentRecord["status"];
    type?: ContentRecord["type"];
    search?: string;
    sortBy?: "createdAt" | "title" | "fileSize" | "type" | "pageNumber";
    sortDirection?: "asc" | "desc";
  }): Promise<{ items: ContentRecord[]; total: number }> {
    return this.queries.list(input);
  }

  async listForOwner(input: {
    ownerId: string;
    offset: number;
    limit: number;
    parentId?: string;
    status?: ContentRecord["status"];
    type?: ContentRecord["type"];
    search?: string;
    sortBy?: "createdAt" | "title" | "fileSize" | "type" | "pageNumber";
    sortDirection?: "asc" | "desc";
  }): Promise<{ items: ContentRecord[]; total: number }> {
    return this.queries.listForOwner(input);
  }

  async findChildrenByParentIds(
    parentIds: string[],
    input?: {
      includeExcluded?: boolean;
      onlyReady?: boolean;
    },
  ): Promise<ContentRecord[]> {
    return this.queries.findChildrenByParentIds(parentIds, input);
  }

  async findChildrenByParentIdsForOwner(
    parentIds: string[],
    ownerId: string,
    input?: {
      includeExcluded?: boolean;
      onlyReady?: boolean;
    },
  ): Promise<ContentRecord[]> {
    return this.queries.findChildrenByParentIdsForOwner(
      parentIds,
      ownerId,
      input,
    );
  }

  async update(
    id: string,
    input: ContentUpdateInput,
  ): Promise<ContentRecord | null> {
    return this.writes.update(id, input);
  }

  async updateForOwner(
    id: string,
    ownerId: string,
    input: ContentUpdateInput,
  ): Promise<ContentRecord | null> {
    return this.writes.updateForOwner(id, ownerId, input);
  }

  async deleteByParentId(parentId: string): Promise<ContentRecord[]> {
    return this.writes.deleteByParentId(parentId);
  }

  async delete(id: string): Promise<boolean> {
    return this.writes.delete(id);
  }

  async deleteForOwner(id: string, ownerId: string): Promise<boolean> {
    return this.writes.deleteForOwner(id, ownerId);
  }
}
