import { and, asc, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import {
  type ContentRecord,
  type ContentRepository,
} from "#/application/ports/content";
import {
  parseContentKind,
  parseContentStatus,
  parseContentType,
} from "#/domain/content/content";
import { db } from "#/infrastructure/db/client";
import {
  content,
  contentAssets,
  contentFlashMessages,
  contentTextContent,
} from "#/infrastructure/db/schema/content.sql";
import { buildLikeContainsPattern } from "#/infrastructure/db/utils/sql";
import { toIsoString } from "./utils/date";

type ContentRow = {
  id: string;
  title: string;
  type: string;
  kind: string;
  status: string;
  parentContentId: string | null;
  pageNumber: number | null;
  pageCount: number | null;
  isExcluded: boolean;
  ownerId: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  fileKey: string | null;
  thumbnailKey: string | null;
  checksum: string | null;
  mimeType: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  scrollPxPerSecond: number | null;
  flashMessage: string | null;
  flashTone: "INFO" | "WARNING" | "CRITICAL" | null;
  textJsonContent: string | null;
  textHtmlContent: string | null;
};

type ContentListInput = {
  ownerId?: string;
  offset: number;
  limit: number;
  parentId?: string;
  status?: ContentRecord["status"];
  type?: ContentRecord["type"];
  search?: string;
  sortBy?: "createdAt" | "title" | "fileSize" | "type" | "pageNumber";
  sortDirection?: "asc" | "desc";
};

type ContentChildrenInput = {
  includeExcluded?: boolean;
  onlyReady?: boolean;
};

export type ContentUpdateInput = Partial<
  Pick<
    ContentRecord,
    | "title"
    | "kind"
    | "status"
    | "fileKey"
    | "thumbnailKey"
    | "parentContentId"
    | "pageNumber"
    | "pageCount"
    | "isExcluded"
    | "type"
    | "mimeType"
    | "fileSize"
    | "width"
    | "height"
    | "duration"
    | "scrollPxPerSecond"
    | "flashMessage"
    | "flashTone"
    | "textJsonContent"
    | "textHtmlContent"
    | "checksum"
  >
>;

const buildBaseContentQuery = () =>
  db
    .select({
      id: content.id,
      title: content.title,
      type: content.type,
      kind: content.kind,
      status: content.status,
      parentContentId: content.parentContentId,
      pageNumber: content.pageNumber,
      pageCount: content.pageCount,
      isExcluded: content.isExcluded,
      ownerId: content.ownerId,
      createdAt: content.createdAt,
      updatedAt: content.updatedAt,
      fileKey: contentAssets.fileKey,
      thumbnailKey: contentAssets.thumbnailKey,
      checksum: contentAssets.checksum,
      mimeType: contentAssets.mimeType,
      fileSize: contentAssets.fileSize,
      width: contentAssets.width,
      height: contentAssets.height,
      duration: contentAssets.duration,
      scrollPxPerSecond: contentAssets.scrollPxPerSecond,
      flashMessage: contentFlashMessages.message,
      flashTone: contentFlashMessages.tone,
      textJsonContent: contentTextContent.jsonContent,
      textHtmlContent: contentTextContent.htmlContent,
    })
    .from(content)
    .innerJoin(contentAssets, eq(contentAssets.contentId, content.id))
    .leftJoin(
      contentFlashMessages,
      eq(contentFlashMessages.contentId, content.id),
    )
    .leftJoin(contentTextContent, eq(contentTextContent.contentId, content.id));

const mapContentRowToRecord = (row: ContentRow): ContentRecord => {
  const parsedType = parseContentType(row.type);
  if (!parsedType) {
    throw new Error(`Invalid content type: ${row.type}`);
  }
  const parsedKind = parseContentKind(row.kind);
  if (!parsedKind) {
    throw new Error(`Invalid content kind: ${row.kind}`);
  }
  const parsedStatus = parseContentStatus(row.status);
  if (!parsedStatus) {
    throw new Error(`Invalid content status: ${row.status}`);
  }

  if (
    row.fileKey == null ||
    row.checksum == null ||
    row.mimeType == null ||
    row.fileSize == null
  ) {
    throw new Error(`Missing content asset row for content ${row.id}`);
  }

  return {
    id: row.id,
    title: row.title,
    type: parsedType,
    kind: parsedKind,
    status: parsedStatus,
    fileKey: row.fileKey,
    thumbnailKey: row.thumbnailKey,
    parentContentId: row.parentContentId,
    pageNumber: row.pageNumber,
    pageCount: row.pageCount,
    isExcluded: row.isExcluded,
    checksum: row.checksum,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    width: row.width,
    height: row.height,
    duration: row.duration,
    scrollPxPerSecond: row.scrollPxPerSecond,
    flashMessage: row.flashMessage,
    flashTone: row.flashTone,
    textJsonContent: row.textJsonContent,
    textHtmlContent: row.textHtmlContent,
    ownerId: row.ownerId,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
};

export class ContentDbRepository implements ContentRepository {
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
    return this.listInternal(input);
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

  async create(
    input: Omit<ContentRecord, "createdAt" | "updatedAt">,
  ): Promise<ContentRecord> {
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx.insert(content).values({
        id: input.id,
        title: input.title,
        type: input.type,
        kind: input.kind,
        status: input.status,
        parentContentId: input.parentContentId,
        pageNumber: input.pageNumber,
        pageCount: input.pageCount,
        isExcluded: input.isExcluded,
        ownerId: input.ownerId,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(contentAssets).values({
        contentId: input.id,
        fileKey: input.fileKey,
        thumbnailKey: input.thumbnailKey ?? null,
        checksum: input.checksum,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        width: input.width,
        height: input.height,
        duration: input.duration,
        scrollPxPerSecond: input.scrollPxPerSecond,
        createdAt: now,
        updatedAt: now,
      });

      if (input.type === "FLASH" && input.flashMessage && input.flashTone) {
        await tx.insert(contentFlashMessages).values({
          contentId: input.id,
          message: input.flashMessage,
          tone: input.flashTone,
          createdAt: now,
          updatedAt: now,
        });
      }

      if (
        input.type === "TEXT" &&
        input.textJsonContent &&
        input.textHtmlContent
      ) {
        await tx.insert(contentTextContent).values({
          contentId: input.id,
          jsonContent: input.textJsonContent,
          htmlContent: input.textHtmlContent,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    const created = await this.findById(input.id);
    if (!created) {
      throw new Error("Failed to load created content");
    }

    return created;
  }

  async update(
    id: string,
    input: ContentUpdateInput,
  ): Promise<ContentRecord | null> {
    return this.updateInternal(id, input);
  }

  async updateForOwner(
    id: string,
    ownerId: string,
    input: ContentUpdateInput,
  ): Promise<ContentRecord | null> {
    return this.updateInternal(id, input, ownerId);
  }

  private async updateInternal(
    id: string,
    input: ContentUpdateInput,
    ownerId?: string,
  ): Promise<ContentRecord | null> {
    const existing = ownerId
      ? await this.findByIdForOwner(id, ownerId)
      : await this.findById(id);
    if (!existing) {
      return null;
    }

    const next: ContentRecord = {
      ...existing,
      ...input,
      id: existing.id,
      createdAt: existing.createdAt,
      ownerId: existing.ownerId,
    };

    const now = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(content)
        .set({
          title: next.title,
          type: next.type,
          kind: next.kind,
          status: next.status,
          parentContentId: next.parentContentId,
          pageNumber: next.pageNumber,
          pageCount: next.pageCount,
          isExcluded: next.isExcluded,
          updatedAt: now,
        })
        .where(
          ownerId
            ? and(eq(content.id, id), eq(content.ownerId, ownerId))
            : eq(content.id, id),
        );

      await tx
        .insert(contentAssets)
        .values({
          contentId: id,
          fileKey: next.fileKey,
          thumbnailKey: next.thumbnailKey,
          checksum: next.checksum,
          mimeType: next.mimeType,
          fileSize: next.fileSize,
          width: next.width,
          height: next.height,
          duration: next.duration,
          scrollPxPerSecond: next.scrollPxPerSecond,
          createdAt: now,
          updatedAt: now,
        })
        .onDuplicateKeyUpdate({
          set: {
            fileKey: next.fileKey,
            thumbnailKey: next.thumbnailKey,
            checksum: next.checksum,
            mimeType: next.mimeType,
            fileSize: next.fileSize,
            width: next.width,
            height: next.height,
            duration: next.duration,
            scrollPxPerSecond: next.scrollPxPerSecond,
            updatedAt: now,
          },
        });

      if (next.type === "FLASH" && next.flashMessage && next.flashTone) {
        await tx
          .insert(contentFlashMessages)
          .values({
            contentId: id,
            message: next.flashMessage,
            tone: next.flashTone,
            createdAt: now,
            updatedAt: now,
          })
          .onDuplicateKeyUpdate({
            set: {
              message: next.flashMessage,
              tone: next.flashTone,
              updatedAt: now,
            },
          });
      } else {
        await tx
          .delete(contentFlashMessages)
          .where(eq(contentFlashMessages.contentId, id));
      }

      if (
        next.type === "TEXT" &&
        next.textJsonContent &&
        next.textHtmlContent
      ) {
        await tx
          .insert(contentTextContent)
          .values({
            contentId: id,
            jsonContent: next.textJsonContent,
            htmlContent: next.textHtmlContent,
            createdAt: now,
            updatedAt: now,
          })
          .onDuplicateKeyUpdate({
            set: {
              jsonContent: next.textJsonContent,
              htmlContent: next.textHtmlContent,
              updatedAt: now,
            },
          });
      } else {
        await tx
          .delete(contentTextContent)
          .where(eq(contentTextContent.contentId, id));
      }
    });

    return ownerId ? this.findByIdForOwner(id, ownerId) : this.findById(id);
  }

  async deleteByParentId(parentId: string): Promise<ContentRecord[]> {
    const rows = await buildBaseContentQuery().where(
      eq(content.parentContentId, parentId),
    );
    if (rows.length === 0) {
      return [];
    }
    await db.delete(content).where(eq(content.parentContentId, parentId));
    return rows.map(mapContentRowToRecord);
  }

  async delete(id: string): Promise<boolean> {
    return this.deleteInternal(id);
  }

  async deleteForOwner(id: string, ownerId: string): Promise<boolean> {
    return this.deleteInternal(id, ownerId);
  }

  private async deleteInternal(id: string, ownerId?: string): Promise<boolean> {
    const result = await db
      .delete(content)
      .where(
        ownerId
          ? and(eq(content.id, id), eq(content.ownerId, ownerId))
          : eq(content.id, id),
      );
    return (result[0]?.affectedRows ?? 0) > 0;
  }
}
