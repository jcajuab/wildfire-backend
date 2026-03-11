import { type ContentRepository } from "#/application/ports/content";
import { type DisplayRepository } from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { paginate } from "#/application/use-cases/shared/pagination";
import { toScheduleView } from "./schedule-view";
import { buildScheduleViewMaps, scheduleTargetVisibleToOwner } from "./shared";

export class ListSchedulesUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      displayRepository: DisplayRepository;
    },
  ) {}

  async execute(input?: {
    ownerId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const schedules = await this.deps.scheduleRepository.list();
    const maps = await buildScheduleViewMaps({
      schedules,
      playlistRepository: this.deps.playlistRepository,
      contentRepository: this.deps.contentRepository,
      displayRepository: this.deps.displayRepository,
      ownerId: input?.ownerId,
    });
    const visibleSchedules = schedules.filter((schedule) =>
      scheduleTargetVisibleToOwner(schedule, maps),
    );
    const views = visibleSchedules.map((schedule) =>
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
    return paginate(views, { page: input?.page, pageSize: input?.pageSize });
  }
}
