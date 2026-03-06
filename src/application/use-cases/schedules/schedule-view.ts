import { type ContentRecord } from "#/application/ports/content";
import { type DisplayRecord } from "#/application/ports/displays";
import { type PlaylistRecord } from "#/application/ports/playlists";
import { type ScheduleRecord } from "#/application/ports/schedules";

export const toScheduleView = (
  schedule: ScheduleRecord,
  playlist: PlaylistRecord | null,
  content: ContentRecord | null,
  display: DisplayRecord | null,
) => ({
  id: schedule.id,
  name: schedule.name,
  kind: schedule.kind ?? "PLAYLIST",
  playlistId: schedule.playlistId,
  contentId: schedule.contentId ?? null,
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
    : schedule.playlistId
      ? { id: schedule.playlistId, name: null }
      : null,
  content: content
    ? {
        id: content.id,
        title: content.title,
        type: content.type,
        flashMessage: content.flashMessage ?? null,
        flashTone: content.flashTone ?? null,
      }
    : schedule.contentId
      ? {
          id: schedule.contentId,
          title: null,
          type: "FLASH" as const,
          flashMessage: null,
          flashTone: null,
        }
      : null,
  display: display
    ? { id: display.id, name: display.name }
    : { id: schedule.displayId, name: null },
});
