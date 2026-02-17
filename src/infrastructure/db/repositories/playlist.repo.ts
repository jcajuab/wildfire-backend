import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  type PlaylistItemRecord,
  type PlaylistRecord,
  type PlaylistRepository,
} from "#/application/ports/playlists";
import { db } from "#/infrastructure/db/client";
import { playlists } from "#/infrastructure/db/schema/playlist.sql";
import { playlistItems } from "#/infrastructure/db/schema/playlist-item.sql";

const toPlaylistRecord = (
  row: typeof playlists.$inferSelect,
): PlaylistRecord => ({
  id: row.id,
  name: row.name,
  description: row.description ?? null,
  createdById: row.createdById,
  createdAt:
    row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  updatedAt:
    row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
});

const toItemRecord = (
  row: typeof playlistItems.$inferSelect,
): PlaylistItemRecord => ({
  id: row.id,
  playlistId: row.playlistId,
  contentId: row.contentId,
  sequence: row.sequence,
  duration: row.duration,
});

export class PlaylistDbRepository implements PlaylistRepository {
  async list(): Promise<PlaylistRecord[]> {
    const rows = await db
      .select()
      .from(playlists)
      .orderBy(desc(playlists.createdAt));
    return rows.map(toPlaylistRecord);
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
    await db.insert(playlists).values({
      id,
      name: input.name,
      description: input.description,
      createdById: input.createdById,
    });

    const record = await this.findById(id);
    if (!record) throw new Error("Failed to load created playlist record");
    return record;
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

    await db
      .update(playlists)
      .set({
        name: next.name,
        description: next.description,
        updatedAt: new Date(),
      })
      .where(eq(playlists.id, id));

    const updated = await this.findById(id);
    return updated ?? { ...existing, ...next, updatedAt: existing.updatedAt };
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
    await db.insert(playlistItems).values({
      id,
      playlistId: input.playlistId,
      contentId: input.contentId,
      sequence: input.sequence,
      duration: input.duration,
    });

    const rows = await db
      .select()
      .from(playlistItems)
      .where(eq(playlistItems.id, id))
      .limit(1);
    if (!rows[0]) throw new Error("Failed to load playlist item");
    return toItemRecord(rows[0]);
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

  async deleteItem(id: string): Promise<boolean> {
    const result = await db
      .delete(playlistItems)
      .where(eq(playlistItems.id, id));
    return result[0]?.affectedRows > 0;
  }
}
