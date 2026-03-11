import { type ContentRepository } from "#/application/ports/content";
import { type DisplayRepository } from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { toScheduleView } from "./schedule-view";
import {
  buildScheduleViewMaps,
  hasDateRangeOverlap,
  scheduleTargetVisibleToOwner,
  toScheduleWindow,
} from "./shared";

export class ListScheduleWindowUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      displayRepository: DisplayRepository;
    },
  ) {}

  async execute(input: {
    ownerId?: string;
    from: string;
    to: string;
    displayIds?: string[];
  }) {
    const filtered =
      this.deps.scheduleRepository.listWindow != null
        ? await this.deps.scheduleRepository.listWindow(input)
        : (await this.deps.scheduleRepository.list())
            .filter((schedule) => {
              if (
                input.displayIds &&
                input.displayIds.length > 0 &&
                !input.displayIds.includes(schedule.displayId)
              ) {
                return false;
              }

              return hasDateRangeOverlap(toScheduleWindow(schedule), {
                name: "window",
                kind: schedule.kind ?? "PLAYLIST",
                playlistId: null,
                contentId: null,
                displayId: schedule.displayId,
                startDate: input.from,
                endDate: input.to,
                startTime: "00:00",
                endTime: "23:59",
              });
            })
            .sort((left, right) => {
              const dateDelta = (left.startDate ?? "").localeCompare(
                right.startDate ?? "",
              );
              if (dateDelta !== 0) {
                return dateDelta;
              }
              const timeDelta = left.startTime.localeCompare(right.startTime);
              if (timeDelta !== 0) {
                return timeDelta;
              }
              return left.name.localeCompare(right.name);
            });

    const maps = await buildScheduleViewMaps({
      schedules: filtered,
      playlistRepository: this.deps.playlistRepository,
      contentRepository: this.deps.contentRepository,
      displayRepository: this.deps.displayRepository,
      ownerId: input.ownerId,
    });

    return filtered
      .filter((schedule) => scheduleTargetVisibleToOwner(schedule, maps))
      .map((schedule) =>
        toScheduleView(
          schedule,
          schedule.playlistId
            ? (maps.playlistMap.get(schedule.playlistId) ?? null)
            : null,
          schedule.contentId
            ? (maps.contentMap.get(schedule.contentId) ?? null)
            : null,
          maps.displayMap.get(schedule.displayId) ?? null,
        ),
      );
  }
}
