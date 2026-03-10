export type ScheduleKind = "PLAYLIST" | "FLASH";

export interface ScheduleRecord {
  id: string;
  name: string;
  kind?: ScheduleKind;
  playlistId: string | null;
  contentId?: string | null;
  displayId: string;
  startDate?: string;
  endDate?: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleRepository {
  list(): Promise<ScheduleRecord[]>;
  listByDisplay(displayId: string): Promise<ScheduleRecord[]>;
  listByDisplayIds?(displayIds: string[]): Promise<ScheduleRecord[]>;
  listByPlaylistId(playlistId: string): Promise<ScheduleRecord[]>;
  listWindow?(input: {
    from: string;
    to: string;
    displayIds?: readonly string[];
  }): Promise<ScheduleRecord[]>;
  listByContentId?(contentId: string): Promise<ScheduleRecord[]>;
  findById(id: string): Promise<ScheduleRecord | null>;
  create(input: {
    name: string;
    kind?: ScheduleKind;
    playlistId: string | null;
    contentId?: string | null;
    displayId: string;
    startDate?: string;
    endDate?: string;
    startTime: string;
    endTime: string;
    isActive: boolean;
  }): Promise<ScheduleRecord>;
  update(
    id: string,
    input: {
      name?: string;
      kind?: ScheduleKind;
      playlistId?: string | null;
      contentId?: string | null;
      displayId?: string;
      startDate?: string;
      endDate?: string;
      startTime?: string;
      endTime?: string;
      isActive?: boolean;
    },
  ): Promise<ScheduleRecord | null>;
  delete(id: string): Promise<boolean>;
  countByPlaylistId(playlistId: string): Promise<number>;
  countByContentId?(contentId: string): Promise<number>;
}
