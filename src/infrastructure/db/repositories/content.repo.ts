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
import { content } from "#/infrastructure/db/schema/content.sql";
import { playlists } from "#/infrastructure/db/schema/playlist.sql";
import { playlistItems } from "#/infrastructure/db/schema/playlist-item.sql";
import { buildLikeContainsPattern } from "#/infrastructure/db/utils/sql";

const toRecord = (row: typeof content.$inferSelect): ContentRecord => {
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

  return {
    id: row.id,
    title: row.title,
    type: parsedType,
    kind: parsedKind,
    status: parsedStatus,
    fileKey: row.fileKey,
    thumbnailKey: row.thumbnailKey ?? null,
    parentContentId: row.parentContentId ?? null,
    pageNumber: row.pageNumber ?? null,
    pageCount: row.pageCount ?? null,
    isExcluded: row.isExcluded,
    checksum: row.checksum,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    width: row.width ?? null,
    height: row.height ?? null,
    duration: row.duration ?? null,
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
    await db.insert(content).values({
      id: input.id,
      title: input.title,
      type: input.type,
      kind: input.kind,
      status: input.status,
      fileKey: input.fileKey,
      thumbnailKey: input.thumbnailKey ?? null,
      parentContentId: input.parentContentId,
      pageNumber: input.pageNumber,
      pageCount: input.pageCount,
      isExcluded: input.isExcluded,
      checksum: input.checksum,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      width: input.width,
      height: input.height,
      duration: input.duration,
      createdById: input.createdById,
      createdAt: now,
    });

    return {
      ...input,
      createdAt: now.toISOString(),
    };
  }

  async findById(id: string): Promise<ContentRecord | null> {
    const result = await db
      .select()
      .from(content)
      .where(eq(content.id, id))
      .limit(1);
    const row = result[0];
    return row ? toRecord(row) : null;
  }

  async findByIds(ids: string[]): Promise<ContentRecord[]> {
    if (ids.length === 0) return [];
    const rows = await db
      .select()
      .from(content)
      .where(inArray(content.id, ids));
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
          ? content.fileSize
          : sortBy === "type"
            ? content.type
            : sortBy === "pageNumber"
              ? content.pageNumber
              : content.createdAt;
    const orderBy =
      sortDirection === "asc"
        ? [asc(orderColumn), asc(content.createdAt)]
        : [desc(orderColumn), desc(content.createdAt)];

    const items = await db
      .select()
      .from(content)
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
      items: items.map(toRecord),
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
    const whereClause = and(...conditions);

    const rows = await db
      .select()
      .from(content)
      .where(whereClause)
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
        | "checksum"
      >
    >,
  ): Promise<ContentRecord | null> {
    await db.update(content).set(input).where(eq(content.id, id));
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
    const rows = await db
      .select()
      .from(content)
      .where(eq(content.parentContentId, parentId));
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
