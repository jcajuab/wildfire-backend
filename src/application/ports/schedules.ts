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
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleRepository {
  list(): Promise<ScheduleRecord[]>;
  listByDisplay(displayId: string): Promise<ScheduleRecord[]>;
  listByPlaylistId(playlistId: string): Promise<ScheduleRecord[]>;
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
    priority: number;
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
      priority?: number;
      isActive?: boolean;
    },
  ): Promise<ScheduleRecord | null>;
  delete(id: string): Promise<boolean>;
  countByPlaylistId(playlistId: string): Promise<number>;
  countByContentId?(contentId: string): Promise<number>;
}
