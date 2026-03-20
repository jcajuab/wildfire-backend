import { eq, sql } from "drizzle-orm";
import { db } from "#/infrastructure/db/client";
import { playlists } from "#/infrastructure/db/schema/playlist.sql";
import { playlistItems } from "#/infrastructure/db/schema/playlist-item.sql";

export class ContentPlaylistReportingService {
  async countPlaylistReferences(contentId: string): Promise<number> {
    const result = await db
      .select({ value: sql<number>`count(*)` })
      .from(playlistItems)
      .where(eq(playlistItems.contentId, contentId));
    return result[0]?.value ?? 0;
  }

  async listPlaylistsReferencingContent(
    contentId: string,
  ): Promise<{ id: string; name: string }[]> {
    const result = await db
      .selectDistinct({ id: playlists.id, name: playlists.name })
      .from(playlistItems)
      .innerJoin(playlists, eq(playlistItems.playlistId, playlists.id))
      .where(eq(playlistItems.contentId, contentId))
      .limit(10);
    return result;
  }
}
