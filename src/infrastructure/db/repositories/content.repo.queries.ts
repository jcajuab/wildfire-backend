import { and, asc, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { type ContentRecord } from "#/application/ports/content";
import { db } from "#/infrastructure/db/client";
import { content, contentAssets } from "#/infrastructure/db/schema/content.sql";
import { buildLikeContainsPattern } from "#/infrastructure/db/utils/sql";
import {
  buildBaseContentQuery,
  type ContentChildrenInput,
  type ContentListInput,
  mapContentRowToRecord,
} from "./content.repo.shared";

export class ContentQueryRepository {
  async findById(id: string): Promise<ContentRecord | null> {
    return this.findByIdInternal(id);
  }

  async findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<ContentRecord | null> {
    return this.findByIdInternal(id, ownerId);
  }

  private async findByIdInternal(
    id: string,
    ownerId?: string,
  ): Promise<ContentRecord | null> {
    const whereClause = ownerId
      ? and(eq(content.id, id), eq(content.ownerId, ownerId))
      : eq(content.id, id);
    const result = await buildBaseContentQuery().where(whereClause).limit(1);
    const row = result[0];
    return row ? mapContentRowToRecord(row) : null;
  }

  async findByIds(ids: string[]): Promise<ContentRecord[]> {
    return this.findByIdsInternal(ids);
  }

  async findByIdsForOwner(
    ids: string[],
    ownerId: string,
  ): Promise<ContentRecord[]> {
    return this.findByIdsInternal(ids, ownerId);
  }

  private async findByIdsInternal(
    ids: string[],
    ownerId?: string,
  ): Promise<ContentRecord[]> {
    if (ids.length === 0) {
      return [];
    }
    const whereClause = ownerId
      ? and(inArray(content.id, ids), eq(content.ownerId, ownerId))
      : inArray(content.id, ids);
    const rows = await buildBaseContentQuery().where(whereClause);
    return rows.map(mapContentRowToRecord);
  }

  async list(input: ContentListInput): Promise<{
    items: ContentRecord[];
    total: number;
  }> {
    return this.listInternal(input);
  }

  async listForOwner(input: ContentListInput & { ownerId: string }): Promise<{
    items: ContentRecord[];
    total: number;
  }> {
    return this.listInternal(input);
  }

  private async listInternal({
    ownerId,
    offset,
    limit,
    parentId,
    status,
    type,
    search,
    sortBy = "createdAt",
    sortDirection = "desc",
  }: ContentListInput): Promise<{ items: ContentRecord[]; total: number }> {
    const conditions = [
      ownerId ? eq(content.ownerId, ownerId) : undefined,
      parentId
        ? eq(content.parentContentId, parentId)
        : isNull(content.parentContentId),
      status ? eq(content.status, status) : undefined,
      type ? eq(content.type, type) : undefined,
      search && search.length > 0
        ? like(content.title, buildLikeContainsPattern(search))
        : undefined,
    ].filter((value) => value !== undefined);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const orderColumn =
      sortBy === "title"
        ? content.title
        : sortBy === "fileSize"
          ? contentAssets.fileSize
          : sortBy === "type"
            ? content.type
            : sortBy === "pageNumber"
              ? content.pageNumber
              : content.createdAt;

    const orderBy =
      sortDirection === "asc"
        ? [asc(orderColumn), asc(content.createdAt)]
        : [desc(orderColumn), desc(content.createdAt)];

    const rows = await buildBaseContentQuery()
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    const totalQuery = db
      .select({ value: sql<number>`count(*)` })
      .from(content);
    const totalResult =
      whereClause === undefined
        ? await totalQuery
        : await totalQuery.where(whereClause);

    return {
      items: rows.map(mapContentRowToRecord),
      total: totalResult[0]?.value ?? 0,
    };
  }

  async findChildrenByParentIds(
    parentIds: string[],
    input?: ContentChildrenInput,
  ): Promise<ContentRecord[]> {
    return this.findChildrenByParentIdsInternal(parentIds, input);
  }

  async findChildrenByParentIdsForOwner(
    parentIds: string[],
    ownerId: string,
    input?: ContentChildrenInput,
  ): Promise<ContentRecord[]> {
    return this.findChildrenByParentIdsInternal(parentIds, input, ownerId);
  }

  private async findChildrenByParentIdsInternal(
    parentIds: string[],
    input?: ContentChildrenInput,
    ownerId?: string,
  ): Promise<ContentRecord[]> {
    if (parentIds.length === 0) {
      return [];
    }

    const conditions = [
      ownerId ? eq(content.ownerId, ownerId) : undefined,
      inArray(content.parentContentId, parentIds),
      input?.onlyReady ? eq(content.status, "READY") : undefined,
      input?.includeExcluded ? undefined : eq(content.isExcluded, false),
    ].filter((value) => value !== undefined);

    const rows = await buildBaseContentQuery()
      .where(and(...conditions))
      .orderBy(
        asc(content.parentContentId),
        asc(content.pageNumber),
        asc(content.createdAt),
      );

    return rows.map(mapContentRowToRecord);
  }
}
