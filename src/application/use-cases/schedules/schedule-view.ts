import { type DisplayRecord } from "#/application/ports/displays";
import { type PlaylistRecord } from "#/application/ports/playlists";
import { type ScheduleRecord } from "#/application/ports/schedules";

export const toScheduleView = (
  schedule: ScheduleRecord,
  playlist: PlaylistRecord | null,
  display: DisplayRecord | null,
) => ({
  id: schedule.id,
  name: schedule.name,
  playlistId: schedule.playlistId,
  displayId: schedule.displayId,
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
  display: display
    ? { id: display.id, name: display.name }
    : { id: schedule.displayId, name: null },
});
