export interface PlaylistRecord {
  id: string;
  name: string;
  description: string | null;
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
  delete(id: string): Promise<boolean>;
  listItems(playlistId: string): Promise<PlaylistItemRecord[]>;
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
  deleteItem(id: string): Promise<boolean>;
}
