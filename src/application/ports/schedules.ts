import { type SchedulableKind } from "#/domain/schedules/schedule";

export type { SchedulableKind as ScheduleKind } from "#/domain/schedules/schedule";

export interface ScheduleRecord {
  id: string;
  name: string;
  kind?: SchedulableKind;
  playlistId: string | null;
  contentId?: string | null;
  displayId: string;
  createdBy?: string;
  startDate?: string;
  endDate?: string;
  startTime: string;
  endTime: string;
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
    kind?: SchedulableKind;
    playlistId: string | null;
    contentId?: string | null;
    displayId: string;
    createdBy: string;
    startDate?: string;
    endDate?: string;
    startTime: string;
    endTime: string;
  }): Promise<ScheduleRecord>;
  update(
    id: string,
    input: {
      name?: string;
      kind?: SchedulableKind;
      playlistId?: string | null;
      contentId?: string | null;
      displayId?: string;
      startDate?: string;
      endDate?: string;
      startTime?: string;
      endTime?: string;
    },
  ): Promise<ScheduleRecord | null>;
  delete(id: string): Promise<boolean>;
  countByPlaylistId(playlistId: string): Promise<number>;
  countByContentId?(contentId: string): Promise<number>;
}
