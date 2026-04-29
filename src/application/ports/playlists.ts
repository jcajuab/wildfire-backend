import { type PlaylistStatus } from "#/domain/playlists/playlist";

export type PlaylistListSortBy = "createdAt" | "updatedAt" | "name";

export interface PlaylistRecord {
  id: string;
  name: string;
  description: string | null;
  status?: PlaylistStatus;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistItemRecord {
  id: string;
  playlistId: string;
  contentId: string;
  sequence: number;
  duration: number;
  loop: boolean;
}

export type PlaylistItemAtomicWriteInput =
  | {
      kind: "existing";
      itemId: string;
      duration: number;
      loop?: boolean;
    }
  | {
      kind: "new";
      contentId: string;
      duration: number;
      loop?: boolean;
    };

export interface PlaylistRepository {
  list(): Promise<PlaylistRecord[]>;
  listForOwner(ownerId: string): Promise<PlaylistRecord[]>;
  listPageForOwner(input: {
    ownerId: string;
    offset: number;
    limit: number;
    status?: PlaylistStatus;
    search?: string;
    sortBy?: PlaylistListSortBy;
    sortDirection?: "asc" | "desc";
  }): Promise<{ items: PlaylistRecord[]; total: number }>;
  listPage(input: {
    offset: number;
    limit: number;
    status?: PlaylistStatus;
    search?: string;
    sortBy?: PlaylistListSortBy;
    sortDirection?: "asc" | "desc";
  }): Promise<{ items: PlaylistRecord[]; total: number }>;
  findByIds(ids: string[]): Promise<PlaylistRecord[]>;
  findByIdsForOwner(ids: string[], ownerId: string): Promise<PlaylistRecord[]>;
  findById(id: string): Promise<PlaylistRecord | null>;
  findByIdForOwner(id: string, ownerId: string): Promise<PlaylistRecord | null>;
  create(input: {
    name: string;
    description: string | null;
    ownerId: string;
  }): Promise<PlaylistRecord>;
  update(
    id: string,
    input: { name?: string; description?: string | null },
  ): Promise<PlaylistRecord | null>;
  updateForOwner(
    id: string,
    ownerId: string,
    input: { name?: string; description?: string | null },
  ): Promise<PlaylistRecord | null>;
  updateStatus(id: string, status: PlaylistStatus): Promise<void>;
  delete(id: string): Promise<boolean>;
  deleteForOwner(id: string, ownerId: string): Promise<boolean>;
  listItems(playlistId: string): Promise<PlaylistItemRecord[]>;
  listItemsByPlaylistIds?(playlistIds: string[]): Promise<PlaylistItemRecord[]>;
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
    loop?: boolean;
  }): Promise<PlaylistItemRecord>;
  updateItem(
    id: string,
    input: { sequence?: number; duration?: number; loop?: boolean },
  ): Promise<PlaylistItemRecord | null>;
  reorderItems(input: {
    playlistId: string;
    orderedItemIds: readonly string[];
  }): Promise<boolean>;
  replaceItemsAtomic?(input: {
    playlistId: string;
    items: readonly PlaylistItemAtomicWriteInput[];
  }): Promise<PlaylistItemRecord[]>;
  deleteItem(id: string): Promise<boolean>;
}
