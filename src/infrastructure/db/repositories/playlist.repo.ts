import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { ValidationError } from "#/application/errors/validation";
import {
  type PlaylistItemAtomicWriteInput,
  type PlaylistItemRecord,
  type PlaylistRecord,
  type PlaylistRepository,
} from "#/application/ports/playlists";
import {
  isPlaylistStatus,
  type PlaylistStatus,
} from "#/domain/playlists/playlist";
import { db } from "#/infrastructure/db/client";
import { playlists } from "#/infrastructure/db/schema/playlist.sql";
import { playlistItems } from "#/infrastructure/db/schema/playlist-item.sql";
import { buildLikeContainsPattern } from "#/infrastructure/db/utils/sql";
import { toIsoString } from "./utils/date";

const mapPlaylistRowToRecord = (
  row: typeof playlists.$inferSelect,
): PlaylistRecord => {
  if (!isPlaylistStatus(row.status)) {
    throw new Error(`Invalid playlist status: ${row.status}`);
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    status: row.status,
    ownerId: row.ownerId,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
};

const mapPlaylistItemRowToRecord = (
  row: typeof playlistItems.$inferSelect,
): PlaylistItemRecord => ({
  id: row.id,
  playlistId: row.playlistId,
  contentId: row.contentId,
  sequence: row.sequence,
  duration: row.duration,
});

const PLAYLIST_SEQUENCE_UNIQUE_INDEX =
  "playlist_items_playlist_id_sequence_unique";

export const mapPlaylistItemInsertError = (error: unknown): Error => {
  if (!(error instanceof Error)) {
    return new Error("Unable to create playlist item");
  }
  const duplicateEntryError = error as {
    code?: string;
    message?: string;
    sqlMessage?: string;
  };
  const rawMessage = [
    duplicateEntryError.message,
    duplicateEntryError.sqlMessage,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (
    duplicateEntryError.code === "ER_DUP_ENTRY" &&
    rawMessage.includes(PLAYLIST_SEQUENCE_UNIQUE_INDEX)
  ) {
    return new ValidationError("Sequence already exists in playlist");
  }
  return error;
};

export class PlaylistDbRepository implements PlaylistRepository {
  async list(): Promise<PlaylistRecord[]> {
    const rows = await db
      .select()
      .from(playlists)
      .orderBy(desc(playlists.updatedAt));
    return rows.map(mapPlaylistRowToRecord);
  }

  async listForOwner(ownerId: string): Promise<PlaylistRecord[]> {
    const rows = await db
      .select()
      .from(playlists)
      .where(eq(playlists.ownerId, ownerId))
      .orderBy(desc(playlists.updatedAt));
    return rows.map(mapPlaylistRowToRecord);
  }

  async listPage(input: {
    offset: number;
    limit: number;
    status?: PlaylistStatus;
    search?: string;
    sortBy?: "updatedAt" | "name";
    sortDirection?: "asc" | "desc";
  }): Promise<{ items: PlaylistRecord[]; total: number }> {
    return this.listPageInternal(input);
  }

  async listPageForOwner(input: {
    ownerId: string;
    offset: number;
    limit: number;
    status?: PlaylistStatus;
    search?: string;
    sortBy?: "updatedAt" | "name";
    sortDirection?: "asc" | "desc";
  }): Promise<{ items: PlaylistRecord[]; total: number }> {
    return this.listPageInternal(input);
  }

  private async listPageInternal(input: {
    ownerId?: string;
    offset: number;
    limit: number;
    status?: PlaylistStatus;
    search?: string;
    sortBy?: "updatedAt" | "name";
    sortDirection?: "asc" | "desc";
  }): Promise<{ items: PlaylistRecord[]; total: number }> {
    const conditions = [
      input.ownerId ? eq(playlists.ownerId, input.ownerId) : undefined,
      input.status ? eq(playlists.status, input.status) : undefined,
      input.search && input.search.length > 0
        ? like(playlists.name, buildLikeContainsPattern(input.search))
        : undefined,
    ].filter((value) => value !== undefined);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const orderColumn =
      input.sortBy === "name" ? playlists.name : playlists.updatedAt;
    const orderBy =
      input.sortDirection === "asc" ? asc(orderColumn) : desc(orderColumn);

    const rows = await db
      .select()
      .from(playlists)
      .where(whereClause)
      .orderBy(orderBy)
      .limit(input.limit)
      .offset(input.offset);

    const totalQuery = db
      .select({ value: sql<number>`count(*)` })
      .from(playlists);
    const totalResult =
      whereClause === undefined
        ? await totalQuery
        : await totalQuery.where(whereClause);

    return {
      items: rows.map(mapPlaylistRowToRecord),
      total: totalResult[0]?.value ?? 0,
    };
  }

  async findByIds(ids: string[]): Promise<PlaylistRecord[]> {
    return this.findByIdsInternal(ids);
  }

  async findByIdsForOwner(
    ids: string[],
    ownerId: string,
  ): Promise<PlaylistRecord[]> {
    return this.findByIdsInternal(ids, ownerId);
  }

  private async findByIdsInternal(
    ids: string[],
    ownerId?: string,
  ): Promise<PlaylistRecord[]> {
    if (ids.length === 0) {
      return [];
    }
    const whereClause = ownerId
      ? and(inArray(playlists.id, ids), eq(playlists.ownerId, ownerId))
      : inArray(playlists.id, ids);
    const rows = await db.select().from(playlists).where(whereClause);
    return rows.map(mapPlaylistRowToRecord);
  }

  async findById(id: string): Promise<PlaylistRecord | null> {
    return this.findByIdInternal(id);
  }

  async findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<PlaylistRecord | null> {
    return this.findByIdInternal(id, ownerId);
  }

  private async findByIdInternal(
    id: string,
    ownerId?: string,
  ): Promise<PlaylistRecord | null> {
    const whereClause = ownerId
      ? and(eq(playlists.id, id), eq(playlists.ownerId, ownerId))
      : eq(playlists.id, id);
    const rows = await db.select().from(playlists).where(whereClause).limit(1);
    return rows[0] ? mapPlaylistRowToRecord(rows[0]) : null;
  }

  async create(input: {
    name: string;
    description: string | null;
    ownerId: string;
  }): Promise<PlaylistRecord> {
    const id = crypto.randomUUID();
    const now = new Date();
    await db.insert(playlists).values({
      id,
      name: input.name,
      description: input.description,
      status: "DRAFT",
      ownerId: input.ownerId,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      name: input.name,
      description: input.description,
      status: "DRAFT",
      ownerId: input.ownerId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async update(
    id: string,
    input: { name?: string; description?: string | null },
  ): Promise<PlaylistRecord | null> {
    return this.updateInternal(id, input);
  }

  async updateForOwner(
    id: string,
    ownerId: string,
    input: { name?: string; description?: string | null },
  ): Promise<PlaylistRecord | null> {
    return this.updateInternal(id, input, ownerId);
  }

  private async updateInternal(
    id: string,
    input: { name?: string; description?: string | null },
    ownerId?: string,
  ): Promise<PlaylistRecord | null> {
    const existing = ownerId
      ? await this.findByIdForOwner(id, ownerId)
      : await this.findById(id);
    if (!existing) return null;

    const next = {
      name: input.name ?? existing.name,
      description:
        input.description !== undefined
          ? input.description
          : existing.description,
    };

    const now = new Date();
    await db
      .update(playlists)
      .set({
        name: next.name,
        description: next.description,
        updatedAt: now,
      })
      .where(
        ownerId
          ? and(eq(playlists.id, id), eq(playlists.ownerId, ownerId))
          : eq(playlists.id, id),
      );

    return {
      ...existing,
      ...next,
      updatedAt: now.toISOString(),
    };
  }

  async updateStatus(id: string, status: PlaylistStatus): Promise<void> {
    await db.update(playlists).set({ status }).where(eq(playlists.id, id));
  }

  async delete(id: string): Promise<boolean> {
    return this.deleteInternal(id);
  }

  async deleteForOwner(id: string, ownerId: string): Promise<boolean> {
    return this.deleteInternal(id, ownerId);
  }

  private async deleteInternal(id: string, ownerId?: string): Promise<boolean> {
    const result = await db
      .delete(playlists)
      .where(
        ownerId
          ? and(eq(playlists.id, id), eq(playlists.ownerId, ownerId))
          : eq(playlists.id, id),
      );
    return (result[0]?.affectedRows ?? 0) > 0;
  }

  async listItems(playlistId: string): Promise<PlaylistItemRecord[]> {
    const rows = await db
      .select()
      .from(playlistItems)
      .where(eq(playlistItems.playlistId, playlistId))
      .orderBy(asc(playlistItems.sequence));
    return rows.map(mapPlaylistItemRowToRecord);
  }

  async listItemStatsByPlaylistIds(
    playlistIds: string[],
  ): Promise<Map<string, { itemsCount: number; totalDuration: number }>> {
    const stats = new Map<
      string,
      { itemsCount: number; totalDuration: number }
    >(playlistIds.map((id) => [id, { itemsCount: 0, totalDuration: 0 }]));
    if (playlistIds.length === 0) {
      return stats;
    }

    const rows = await db
      .select({
        playlistId: playlistItems.playlistId,
        itemsCount: sql<number>`count(*)`,
        totalDuration: sql<number>`coalesce(sum(${playlistItems.duration}), 0)`,
      })
      .from(playlistItems)
      .where(inArray(playlistItems.playlistId, playlistIds))
      .groupBy(playlistItems.playlistId);

    for (const row of rows) {
      stats.set(row.playlistId, {
        itemsCount: Number(row.itemsCount),
        totalDuration: Number(row.totalDuration),
      });
    }
    return stats;
  }

  async findItemById(id: string): Promise<PlaylistItemRecord | null> {
    const rows = await db
      .select()
      .from(playlistItems)
      .where(eq(playlistItems.id, id))
      .limit(1);
    return rows[0] ? mapPlaylistItemRowToRecord(rows[0]) : null;
  }

  async countItemsByContentId(contentId: string): Promise<number> {
    const result = await db
      .select({ value: sql<number>`count(*)` })
      .from(playlistItems)
      .where(eq(playlistItems.contentId, contentId));
    return result[0]?.value ?? 0;
  }

  async addItem(input: {
    playlistId: string;
    contentId: string;
    sequence: number;
    duration: number;
  }): Promise<PlaylistItemRecord> {
    const id = crypto.randomUUID();
    try {
      await db.insert(playlistItems).values({
        id,
        playlistId: input.playlistId,
        contentId: input.contentId,
        sequence: input.sequence,
        duration: input.duration,
      });
    } catch (error) {
      throw mapPlaylistItemInsertError(error);
    }

    return {
      id,
      playlistId: input.playlistId,
      contentId: input.contentId,
      sequence: input.sequence,
      duration: input.duration,
    };
  }

  async updateItem(
    id: string,
    input: { sequence?: number; duration?: number },
  ): Promise<PlaylistItemRecord | null> {
    const existing = await this.findItemById(id);
    if (!existing) return null;

    await db
      .update(playlistItems)
      .set({
        sequence: input.sequence ?? existing.sequence,
        duration: input.duration ?? existing.duration,
      })
      .where(eq(playlistItems.id, id));

    return this.findItemById(id);
  }

  async reorderItems(input: {
    playlistId: string;
    orderedItemIds: readonly string[];
  }): Promise<boolean> {
    const existing = await this.listItems(input.playlistId);
    if (existing.length === 0) {
      return input.orderedItemIds.length === 0;
    }

    const existingIds = existing.map((item) => item.id);
    if (existingIds.length !== input.orderedItemIds.length) {
      return false;
    }
    const nextSet = new Set(input.orderedItemIds);
    if (nextSet.size !== input.orderedItemIds.length) {
      return false;
    }
    for (const id of existingIds) {
      if (!nextSet.has(id)) {
        return false;
      }
    }

    await db.transaction(async (tx) => {
      // Move sequences away first to avoid unique collisions during swaps.
      for (const [index, itemId] of input.orderedItemIds.entries()) {
        await tx
          .update(playlistItems)
          .set({ sequence: 10_000 + index + 1 })
          .where(eq(playlistItems.id, itemId));
      }
      for (const [index, itemId] of input.orderedItemIds.entries()) {
        await tx
          .update(playlistItems)
          .set({ sequence: index + 1 })
          .where(eq(playlistItems.id, itemId));
      }
    });

    return true;
  }

  async replaceItemsAtomic(input: {
    playlistId: string;
    items: readonly PlaylistItemAtomicWriteInput[];
  }): Promise<PlaylistItemRecord[]> {
    const existing = await this.listItems(input.playlistId);
    const existingById = new Map(existing.map((item) => [item.id, item]));
    const existingIdsToKeep = new Set(
      input.items
        .filter(
          (
            item,
          ): item is Extract<
            PlaylistItemAtomicWriteInput,
            { kind: "existing" }
          > => item.kind === "existing",
        )
        .map((item) => item.itemId),
    );

    try {
      await db.transaction(async (tx) => {
        const idsToDelete = existing
          .filter((item) => !existingIdsToKeep.has(item.id))
          .map((item) => item.id);
        if (idsToDelete.length > 0) {
          await tx
            .delete(playlistItems)
            .where(inArray(playlistItems.id, idsToDelete));
        }

        const maxSequence = existing.reduce(
          (current, item) => Math.max(current, item.sequence),
          0,
        );
        const temporarySequenceBase =
          maxSequence + input.items.length + existing.length + 1_000;
        for (const [index, item] of input.items.entries()) {
          if (item.kind !== "existing") {
            continue;
          }
          if (!existingById.has(item.itemId)) {
            continue;
          }
          await tx
            .update(playlistItems)
            .set({ sequence: temporarySequenceBase + index })
            .where(eq(playlistItems.id, item.itemId));
        }

        for (const [index, item] of input.items.entries()) {
          const sequence = index + 1;
          if (item.kind === "existing") {
            await tx
              .update(playlistItems)
              .set({
                sequence,
                duration: item.duration,
              })
              .where(eq(playlistItems.id, item.itemId));
            continue;
          }

          await tx.insert(playlistItems).values({
            id: crypto.randomUUID(),
            playlistId: input.playlistId,
            contentId: item.contentId,
            sequence,
            duration: item.duration,
          });
        }
      });
    } catch (error) {
      throw mapPlaylistItemInsertError(error);
    }

    return this.listItems(input.playlistId);
  }

  async deleteItem(id: string): Promise<boolean> {
    const result = await db
      .delete(playlistItems)
      .where(eq(playlistItems.id, id));
    return (result[0]?.affectedRows ?? 0) > 0;
  }
}
