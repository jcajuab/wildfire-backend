export interface ScheduleRecord {
  id: string;
  seriesId: string;
  name: string;
  playlistId: string;
  deviceId: string;
  startDate?: string;
  endDate?: string;
  startTime: string;
  endTime: string;
  dayOfWeek: number;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleRepository {
  list(): Promise<ScheduleRecord[]>;
  listByDevice(deviceId: string): Promise<ScheduleRecord[]>;
  listBySeries(seriesId: string): Promise<ScheduleRecord[]>;
  listByPlaylistId(playlistId: string): Promise<ScheduleRecord[]>;
  findById(id: string): Promise<ScheduleRecord | null>;
  create(input: {
    seriesId: string;
    name: string;
    playlistId: string;
    deviceId: string;
    startDate?: string;
    endDate?: string;
    startTime: string;
    endTime: string;
    dayOfWeek: number;
    priority: number;
    isActive: boolean;
  }): Promise<ScheduleRecord>;
  update(
    id: string,
    input: {
      name?: string;
      playlistId?: string;
      deviceId?: string;
      startDate?: string;
      endDate?: string;
      startTime?: string;
      endTime?: string;
      dayOfWeek?: number;
      priority?: number;
      isActive?: boolean;
    },
  ): Promise<ScheduleRecord | null>;
  delete(id: string): Promise<boolean>;
  deleteBySeries(seriesId: string): Promise<number>;
  countByPlaylistId(playlistId: string): Promise<number>;
}
