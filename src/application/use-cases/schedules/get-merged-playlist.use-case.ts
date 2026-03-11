import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { selectActiveSchedulesByKind } from "#/domain/schedules/schedule";
import { DEFAULT_SCHEDULE_TIMEZONE } from "./shared";

export interface MergedPlaylistItem {
  scheduleId: string;
  scheduleName: string;
  playlistId: string;
  playlistName: string;
  contentId: string;
  sequence: number;
  duration: number;
}

export interface MergedPlaylistResult {
  scheduleIds: string[];
  items: MergedPlaylistItem[];
  totalDuration: number;
}

export class GetMergedPlaylistUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input: {
    displayId: string;
    time?: Date;
  }): Promise<MergedPlaylistResult> {
    const now = input.time ?? new Date();
    const timeZone = this.deps.scheduleTimeZone ?? DEFAULT_SCHEDULE_TIMEZONE;

    const schedules = await this.deps.scheduleRepository.listByDisplay(
      input.displayId,
    );

    const activeSchedules = selectActiveSchedulesByKind(
      schedules,
      "PLAYLIST",
      now,
      timeZone,
    );

    if (activeSchedules.length === 0) {
      return { scheduleIds: [], items: [], totalDuration: 0 };
    }

    const playlistIds = activeSchedules
      .map((s) => s.playlistId)
      .filter((id): id is string => id !== null);

    const playlists = await this.deps.playlistRepository.findByIds(playlistIds);
    const playlistMap = new Map(playlists.map((p) => [p.id, p]));

    const allItems: MergedPlaylistItem[] = [];

    for (const schedule of activeSchedules) {
      if (!schedule.playlistId) continue;

      const playlist = playlistMap.get(schedule.playlistId);
      if (!playlist) continue;

      const items = await this.deps.playlistRepository.listItems(
        schedule.playlistId,
      );

      const sortedItems = [...items].sort((a, b) => a.sequence - b.sequence);

      for (const item of sortedItems) {
        allItems.push({
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          playlistId: schedule.playlistId,
          playlistName: playlist.name,
          contentId: item.contentId,
          sequence: item.sequence,
          duration: item.duration,
        });
      }
    }

    const totalDuration = allItems.reduce(
      (sum, item) => sum + item.duration,
      0,
    );

    return {
      scheduleIds: activeSchedules.map((s) => s.id),
      items: allItems,
      totalDuration,
    };
  }
}
