import { desc, eq, inArray, sql } from "drizzle-orm";
import {
  type ContentRecord,
  type ContentRepository,
} from "#/application/ports/content";
import { parseContentType } from "#/domain/content/content";
import { db } from "#/infrastructure/db/client";
import { content } from "#/infrastructure/db/schema/content.sql";

const toRecord = (row: typeof content.$inferSelect): ContentRecord => {
  const parsedType = parseContentType(row.type);
  if (!parsedType) {
    throw new Error(`Invalid content type: ${row.type}`);
  }

  return {
    id: row.id,
    title: row.title,
    type: parsedType,
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
    await db.insert(content).values({
      id: input.id,
      title: input.title,
      type: input.type,
      fileKey: input.fileKey,
      checksum: input.checksum,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      width: input.width,
      height: input.height,
      duration: input.duration,
      createdById: input.createdById,
    });

    const record = await this.findById(input.id);
    if (!record) {
      throw new Error("Failed to load created content record");
    }
    return record;
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
  }: {
    offset: number;
    limit: number;
  }): Promise<{ items: ContentRecord[]; total: number }> {
    const items = await db
      .select()
      .from(content)
      .orderBy(desc(content.createdAt))
      .limit(limit)
      .offset(offset);
    const totalResult = await db
      .select({ value: sql<number>`count(*)` })
      .from(content);

    return {
      items: items.map(toRecord),
      total: totalResult[0]?.value ?? 0,
    };
  }

  async update(
    id: string,
    input: Partial<Pick<ContentRecord, "title">>,
  ): Promise<ContentRecord | null> {
    await db.update(content).set(input).where(eq(content.id, id));
    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(content).where(eq(content.id, id));
    return result[0]?.affectedRows > 0;
  }
}
