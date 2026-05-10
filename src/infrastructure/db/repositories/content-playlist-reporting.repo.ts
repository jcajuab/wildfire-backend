import { eq, inArray, sql } from "drizzle-orm";
import { type ContentPlaylistReportingPort } from "#/application/ports/content-playlist-reporting";
import { db } from "#/infrastructure/db/client";
import { playlists } from "#/infrastructure/db/schema/playlist.sql";
import { playlistItems } from "#/infrastructure/db/schema/playlist-item.sql";

export class ContentPlaylistReportingRepository
  implements ContentPlaylistReportingPort
{
  async countPlaylistReferences(contentId: string): Promise<number> {
    const result = await db
      .select({ value: sql<number>`count(*)` })
      .from(playlistItems)
      .where(eq(playlistItems.contentId, contentId));
    return result[0]?.value ?? 0;
  }

  async countPlaylistReferencesByContentIds(
    contentIds: readonly string[],
  ): Promise<Map<string, number>> {
    if (contentIds.length === 0) return new Map();

    const result = await db
      .select({
        contentId: playlistItems.contentId,
        value: sql<number>`count(*)`,
      })
      .from(playlistItems)
      .where(inArray(playlistItems.contentId, [...contentIds]))
      .groupBy(playlistItems.contentId);

    return new Map(result.map((row) => [row.contentId, row.value]));
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
