import { type ContentRecord } from "#/application/ports/content";
import {
  type PlaylistItemRecord,
  type PlaylistRecord,
} from "#/application/ports/playlists";

export const toPlaylistView = (
  playlist: PlaylistRecord,
  creatorName: string | null,
  stats?: { itemsCount: number; totalDuration: number },
) => ({
  id: playlist.id,
  name: playlist.name,
  description: playlist.description,
  status: playlist.status ?? "DRAFT",
  itemsCount: stats?.itemsCount ?? 0,
  totalDuration: stats?.totalDuration ?? 0,
  createdAt: playlist.createdAt,
  updatedAt: playlist.updatedAt,
  createdBy: {
    id: playlist.createdById,
    name: creatorName,
  },
});

export const toPlaylistItemView = (
  item: PlaylistItemRecord,
  content: ContentRecord,
) => ({
  id: item.id,
  sequence: item.sequence,
  duration: item.duration,
  content: {
    id: content.id,
    title: content.title,
    type: content.type,
    checksum: content.checksum,
  },
});
