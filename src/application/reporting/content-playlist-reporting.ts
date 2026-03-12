import { eq, or, sql } from "drizzle-orm";
import { db } from "#/infrastructure/db/client";
import { content } from "#/infrastructure/db/schema/content.sql";
import { playlists } from "#/infrastructure/db/schema/playlist.sql";
import { playlistItems } from "#/infrastructure/db/schema/playlist-item.sql";

const hasMissingPlaylistItemsTable = (error: unknown): boolean => {
  if (error === null || error === undefined) {
    return false;
  }

  const details = error as { code?: string; message?: string };
  return (
    details.code === "ER_NO_SUCH_TABLE" ||
    details.message?.includes("playlist_items") ||
    false
  );
};

export class ContentPlaylistReportingService {
  async countPlaylistReferences(contentId: string): Promise<number> {
    try {
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
    } catch (error) {
      if (hasMissingPlaylistItemsTable(error)) {
        return 0;
      }
      throw error;
    }
  }

  async listPlaylistsReferencingContent(
    contentId: string,
  ): Promise<{ id: string; name: string }[]> {
    try {
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
    } catch (error) {
      if (hasMissingPlaylistItemsTable(error)) {
        return [];
      }
      throw error;
    }
  }
}
