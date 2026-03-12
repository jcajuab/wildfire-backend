import { type ContentRecord } from "#/application/ports/content";
import {
  type PlaylistItemRecord,
  type PlaylistRecord,
} from "#/application/ports/playlists";

export const toPlaylistView = (
  playlist: PlaylistRecord,
  ownerName: string | null,
  stats?: { itemsCount: number; totalDuration: number },
  input?: {
    previewItems?: ReturnType<typeof toPlaylistItemView>[];
  },
) => ({
  id: playlist.id,
  name: playlist.name,
  description: playlist.description,
  status: playlist.status ?? "DRAFT",
  itemsCount: stats?.itemsCount ?? 0,
  totalDuration: stats?.totalDuration ?? 0,
  createdAt: playlist.createdAt,
  updatedAt: playlist.updatedAt,
  owner: {
    id: playlist.ownerId,
    name: ownerName,
  },
  ...(input && "previewItems" in input
    ? { previewItems: input.previewItems ?? [] }
    : {}),
});

export const toPlaylistItemView = (
  item: PlaylistItemRecord,
  content: ContentRecord,
  input?: {
    thumbnailUrl?: string | null;
  },
) => ({
  id: item.id,
  sequence: item.sequence,
  duration: item.duration,
  content: {
    id: content.id,
    title: content.title,
    type: content.type,
    checksum: content.checksum,
    thumbnailUrl: input?.thumbnailUrl ?? null,
  },
});
