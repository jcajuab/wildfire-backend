import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  like,
  or,
  sql,
} from "drizzle-orm";
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
} from "#/infrastructure/db/schema/content.sql";
import { playlists } from "#/infrastructure/db/schema/playlist.sql";
import { playlistItems } from "#/infrastructure/db/schema/playlist-item.sql";
import { buildLikeContainsPattern } from "#/infrastructure/db/utils/sql";

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
  createdById: string;
  createdAt: Date | string;
  fileKey: string | null;
  thumbnailKey: string | null;
  checksum: string | null;
  mimeType: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  flashMessage: string | null;
  flashTone: "INFO" | "WARNING" | "CRITICAL" | null;
};

const baseQuery = () =>
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
      createdById: content.createdById,
      createdAt: content.createdAt,
      fileKey: contentAssets.fileKey,
      thumbnailKey: contentAssets.thumbnailKey,
      checksum: contentAssets.checksum,
      mimeType: contentAssets.mimeType,
      fileSize: contentAssets.fileSize,
      width: contentAssets.width,
      height: contentAssets.height,
      duration: contentAssets.duration,
      flashMessage: contentFlashMessages.message,
      flashTone: contentFlashMessages.tone,
    })
    .from(content)
    .innerJoin(contentAssets, eq(contentAssets.contentId, content.id))
    .leftJoin(
      contentFlashMessages,
      eq(contentFlashMessages.contentId, content.id),
    );

const toRecord = (row: ContentRow): ContentRecord => {
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
    flashMessage: row.flashMessage,
    flashTone: row.flashTone,
    createdById: row.createdById,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : row.createdAt,
  };
};

export class ContentDbRepository implements ContentRepository {
  async create(
    input: Omit<ContentRecord, "createdAt">,
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
        createdById: input.createdById,
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
    });

    const created = await this.findById(input.id);
    if (!created) {
      throw new Error("Failed to load created content");
    }

    return created;
  }

  async findById(id: string): Promise<ContentRecord | null> {
    const result = await baseQuery().where(eq(content.id, id)).limit(1);
    const row = result[0];
    return row ? toRecord(row) : null;
  }

  async findByIds(ids: string[]): Promise<ContentRecord[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await baseQuery().where(inArray(content.id, ids));
    return rows.map(toRecord);
  }

  async list({
    offset,
    limit,
    parentId,
    status,
    type,
    search,
    sortBy = "createdAt",
    sortDirection = "desc",
  }: {
    offset: number;
    limit: number;
    parentId?: string;
    status?: ContentRecord["status"];
    type?: ContentRecord["type"];
    search?: string;
    sortBy?: "createdAt" | "title" | "fileSize" | "type" | "pageNumber";
    sortDirection?: "asc" | "desc";
  }): Promise<{ items: ContentRecord[]; total: number }> {
    const conditions = [
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

    const rows = await baseQuery()
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
      items: rows.map(toRecord),
      total: totalResult[0]?.value ?? 0,
    };
  }

  async findChildrenByParentIds(
    parentIds: string[],
    input?: {
      includeExcluded?: boolean;
      onlyReady?: boolean;
    },
  ): Promise<ContentRecord[]> {
    if (parentIds.length === 0) {
      return [];
    }

    const conditions = [
      inArray(content.parentContentId, parentIds),
      input?.onlyReady ? eq(content.status, "READY") : undefined,
      input?.includeExcluded ? undefined : eq(content.isExcluded, false),
    ].filter((value) => value !== undefined);

    const rows = await baseQuery()
      .where(and(...conditions))
      .orderBy(
        asc(content.parentContentId),
        asc(content.pageNumber),
        asc(content.createdAt),
      );

    return rows.map(toRecord);
  }

  async update(
    id: string,
    input: Partial<
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
        | "flashMessage"
        | "flashTone"
        | "checksum"
      >
    >,
  ): Promise<ContentRecord | null> {
    const existing = await this.findById(id);
    if (!existing) {
      return null;
    }

    const next: ContentRecord = {
      ...existing,
      ...input,
      id: existing.id,
      createdAt: existing.createdAt,
      createdById: existing.createdById,
      fileKey: input.fileKey ?? existing.fileKey,
      thumbnailKey:
        input.thumbnailKey !== undefined
          ? input.thumbnailKey
          : existing.thumbnailKey,
      checksum: input.checksum ?? existing.checksum,
      mimeType: input.mimeType ?? existing.mimeType,
      fileSize: input.fileSize ?? existing.fileSize,
      width: input.width !== undefined ? input.width : existing.width,
      height: input.height !== undefined ? input.height : existing.height,
      duration:
        input.duration !== undefined ? input.duration : existing.duration,
      flashMessage:
        input.flashMessage !== undefined
          ? input.flashMessage
          : existing.flashMessage,
      flashTone:
        input.flashTone !== undefined ? input.flashTone : existing.flashTone,
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
        .where(eq(content.id, id));

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
    });

    return this.findById(id);
  }

  async countPlaylistReferences(contentId: string): Promise<number> {
    const result = await db
      .select({ value: sql<number>`count(*)` })
      .from(playlistItems)
      .leftJoin(content, eq(content.id, playlistItems.contentId))
      .where(
        or(
          eq(playlistItems.contentId, contentId),
          eq(content.parentContentId, contentId),
        ),
      );
    return result[0]?.value ?? 0;
  }

  async listPlaylistsReferencingContent(
    contentId: string,
  ): Promise<{ id: string; name: string }[]> {
    const result = await db
      .selectDistinct({ id: playlists.id, name: playlists.name })
      .from(playlistItems)
      .innerJoin(playlists, eq(playlistItems.playlistId, playlists.id))
      .leftJoin(content, eq(content.id, playlistItems.contentId))
      .where(
        or(
          eq(playlistItems.contentId, contentId),
          eq(content.parentContentId, contentId),
        ),
      )
      .limit(10);
    return result;
  }

  async deleteByParentId(parentId: string): Promise<ContentRecord[]> {
    const rows = await baseQuery().where(eq(content.parentContentId, parentId));
    if (rows.length === 0) {
      return [];
    }
    await db.delete(content).where(eq(content.parentContentId, parentId));
    return rows.map(toRecord);
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(content).where(eq(content.id, id));
    return result[0]?.affectedRows > 0;
  }
}
