import { and, eq } from "drizzle-orm";
import { type ContentRecord } from "#/application/ports/content";
import { db } from "#/infrastructure/db/client";
import {
  content,
  contentAssets,
  contentFlashMessages,
} from "#/infrastructure/db/schema/content.sql";
import {
  buildBaseContentQuery,
  type ContentUpdateInput,
  mapContentRowToRecord,
} from "./content.repo.shared";

interface ContentRecordLoader {
  findById(id: string): Promise<ContentRecord | null>;
  findByIdForOwner(id: string, ownerId: string): Promise<ContentRecord | null>;
}

export class ContentWriteRepository {
  constructor(private readonly loader: ContentRecordLoader) {}

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
    });

    const created = await this.loader.findById(input.id);
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
      ? await this.loader.findByIdForOwner(id, ownerId)
      : await this.loader.findById(id);
    if (!existing) {
      return null;
    }

    const next: ContentRecord = {
      ...existing,
      ...input,
      id: existing.id,
      createdAt: existing.createdAt,
      ownerId: existing.ownerId,
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
      scrollPxPerSecond:
        input.scrollPxPerSecond !== undefined
          ? input.scrollPxPerSecond
          : existing.scrollPxPerSecond,
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
    });

    return ownerId
      ? this.loader.findByIdForOwner(id, ownerId)
      : this.loader.findById(id);
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
    return result[0]?.affectedRows > 0;
  }
}
