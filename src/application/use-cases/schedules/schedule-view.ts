import { type DeviceRecord } from "#/application/ports/devices";
import { type PlaylistRecord } from "#/application/ports/playlists";
import { type ScheduleRecord } from "#/application/ports/schedules";

export const toScheduleView = (
  schedule: ScheduleRecord,
  playlist: PlaylistRecord | null,
  device: DeviceRecord | null,
) => ({
  id: schedule.id,
  name: schedule.name,
  playlistId: schedule.playlistId,
  deviceId: schedule.deviceId,
  startDate: schedule.startDate ?? "",
  endDate: schedule.endDate ?? "",
  startTime: schedule.startTime,
  endTime: schedule.endTime,
  priority: schedule.priority,
  isActive: schedule.isActive,
  createdAt: schedule.createdAt,
  updatedAt: schedule.updatedAt,
  playlist: playlist
    ? { id: playlist.id, name: playlist.name }
    : { id: schedule.playlistId, name: null },
  device: device
    ? { id: device.id, name: device.name }
    : { id: schedule.deviceId, name: null },
});
