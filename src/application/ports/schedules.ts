export interface ScheduleRecord {
  id: string;
  name: string;
  playlistId: string;
  deviceId: string;
  startDate?: string;
  endDate?: string;
  startTime: string;
  endTime: string;
  daysOfWeek: number[];
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleRepository {
  list(): Promise<ScheduleRecord[]>;
  listByDevice(deviceId: string): Promise<ScheduleRecord[]>;
  findById(id: string): Promise<ScheduleRecord | null>;
  create(input: {
    name: string;
    playlistId: string;
    deviceId: string;
    startDate?: string;
    endDate?: string;
    startTime: string;
    endTime: string;
    daysOfWeek: number[];
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
      daysOfWeek?: number[];
      priority?: number;
      isActive?: boolean;
    },
  ): Promise<ScheduleRecord | null>;
  delete(id: string): Promise<boolean>;
  countByPlaylistId?(playlistId: string): Promise<number>;
}
