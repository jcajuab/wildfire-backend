import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { ValidationError } from "#/application/errors/validation";
import {
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

const toPlaylistRecord = (
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
    createdById: row.createdById,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : row.createdAt,
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : row.updatedAt,
  };
};

const toItemRecord = (
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
    return rows.map(toPlaylistRecord);
  }

  async listPage(input: {
    offset: number;
    limit: number;
    status?: PlaylistStatus;
    search?: string;
    sortBy?: "updatedAt" | "name";
    sortDirection?: "asc" | "desc";
  }): Promise<{ items: PlaylistRecord[]; total: number }> {
    const conditions = [
      input.status ? eq(playlists.status, input.status) : undefined,
      input.search && input.search.length > 0
        ? like(playlists.name, `%${input.search.replaceAll("%", "\\%")}%`)
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
      items: rows.map(toPlaylistRecord),
      total: totalResult[0]?.value ?? 0,
    };
  }

  async findByIds(ids: string[]): Promise<PlaylistRecord[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await db
      .select()
      .from(playlists)
      .where(inArray(playlists.id, ids));
    return rows.map(toPlaylistRecord);
  }

  async findById(id: string): Promise<PlaylistRecord | null> {
    const rows = await db
      .select()
      .from(playlists)
      .where(eq(playlists.id, id))
      .limit(1);
    return rows[0] ? toPlaylistRecord(rows[0]) : null;
  }

  async create(input: {
    name: string;
    description: string | null;
    createdById: string;
  }): Promise<PlaylistRecord> {
    const id = crypto.randomUUID();
    const now = new Date();
    await db.insert(playlists).values({
      id,
      name: input.name,
      description: input.description,
      status: "DRAFT",
      createdById: input.createdById,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      name: input.name,
      description: input.description,
      status: "DRAFT",
      createdById: input.createdById,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async update(
    id: string,
    input: { name?: string; description?: string | null },
  ): Promise<PlaylistRecord | null> {
    const existing = await this.findById(id);
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
      .where(eq(playlists.id, id));

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
    const result = await db.delete(playlists).where(eq(playlists.id, id));
    return result[0]?.affectedRows > 0;
  }

  async listItems(playlistId: string): Promise<PlaylistItemRecord[]> {
    const rows = await db
      .select()
      .from(playlistItems)
      .where(eq(playlistItems.playlistId, playlistId))
      .orderBy(asc(playlistItems.sequence));
    return rows.map(toItemRecord);
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
    return rows[0] ? toItemRecord(rows[0]) : null;
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

  async deleteItem(id: string): Promise<boolean> {
    const result = await db
      .delete(playlistItems)
      .where(eq(playlistItems.id, id));
    return result[0]?.affectedRows > 0;
  }
}
