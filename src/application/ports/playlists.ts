import { type PlaylistStatus } from "#/domain/playlists/playlist";

export interface PlaylistRecord {
  id: string;
  name: string;
  description: string | null;
  status?: PlaylistStatus;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistItemRecord {
  id: string;
  playlistId: string;
  contentId: string;
  sequence: number;
  duration: number;
}

export interface PlaylistRepository {
  list(): Promise<PlaylistRecord[]>;
  listPage(input: {
    offset: number;
    limit: number;
    status?: PlaylistStatus;
    search?: string;
    sortBy?: "updatedAt" | "name";
    sortDirection?: "asc" | "desc";
  }): Promise<{ items: PlaylistRecord[]; total: number }>;
  findByIds(ids: string[]): Promise<PlaylistRecord[]>;
  findById(id: string): Promise<PlaylistRecord | null>;
  create(input: {
    name: string;
    description: string | null;
    createdById: string;
  }): Promise<PlaylistRecord>;
  update(
    id: string,
    input: { name?: string; description?: string | null },
  ): Promise<PlaylistRecord | null>;
  updateStatus(id: string, status: PlaylistStatus): Promise<void>;
  delete(id: string): Promise<boolean>;
  listItems(playlistId: string): Promise<PlaylistItemRecord[]>;
  listItemStatsByPlaylistIds?(
    playlistIds: string[],
  ): Promise<Map<string, { itemsCount: number; totalDuration: number }>>;
  findItemById(id: string): Promise<PlaylistItemRecord | null>;
  countItemsByContentId(contentId: string): Promise<number>;
  addItem(input: {
    playlistId: string;
    contentId: string;
    sequence: number;
    duration: number;
  }): Promise<PlaylistItemRecord>;
  updateItem(
    id: string,
    input: { sequence?: number; duration?: number },
  ): Promise<PlaylistItemRecord | null>;
  reorderItems(input: {
    playlistId: string;
    orderedItemIds: readonly string[];
  }): Promise<boolean>;
  deleteItem(id: string): Promise<boolean>;
}
