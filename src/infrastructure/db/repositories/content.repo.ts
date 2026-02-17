import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import {
  type ContentRecord,
  type ContentRepository,
} from "#/application/ports/content";
import { parseContentStatus, parseContentType } from "#/domain/content/content";
import { db } from "#/infrastructure/db/client";
import { content } from "#/infrastructure/db/schema/content.sql";
import { playlistItems } from "#/infrastructure/db/schema/playlist-item.sql";

const toRecord = (row: typeof content.$inferSelect): ContentRecord => {
  const parsedType = parseContentType(row.type);
  if (!parsedType) {
    throw new Error(`Invalid content type: ${row.type}`);
  }
  const parsedStatus = parseContentStatus(row.status);
  if (!parsedStatus) {
    throw new Error(`Invalid content status: ${row.status}`);
  }

  return {
    id: row.id,
    title: row.title,
    type: parsedType,
    status: parsedStatus,
    fileKey: row.fileKey,
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
      status: input.status,
      fileKey: input.fileKey,
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
    status,
    type,
    search,
    sortBy = "createdAt",
    sortDirection = "desc",
  }: {
    offset: number;
    limit: number;
    status?: ContentRecord["status"];
    type?: ContentRecord["type"];
    search?: string;
    sortBy?: "createdAt" | "title" | "fileSize" | "type";
    sortDirection?: "asc" | "desc";
  }): Promise<{ items: ContentRecord[]; total: number }> {
    const conditions = [
      status ? eq(content.status, status) : undefined,
      type ? eq(content.type, type) : undefined,
      search && search.length > 0
        ? like(content.title, `%${search.replaceAll("%", "\\%")}%`)
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
            : content.createdAt;
    const orderBy =
      sortDirection === "asc" ? asc(orderColumn) : desc(orderColumn);

    const items = await db
      .select()
      .from(content)
      .where(whereClause)
      .orderBy(orderBy)
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

  async update(
    id: string,
    input: Partial<Pick<ContentRecord, "title" | "status">>,
  ): Promise<ContentRecord | null> {
    await db.update(content).set(input).where(eq(content.id, id));
    return this.findById(id);
  }

  async countPlaylistReferences(contentId: string): Promise<number> {
    const result = await db
      .select({ value: sql<number>`count(*)` })
      .from(playlistItems)
      .where(eq(playlistItems.contentId, contentId));
    return result[0]?.value ?? 0;
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(content).where(eq(content.id, id));
    return result[0]?.affectedRows > 0;
  }
}
