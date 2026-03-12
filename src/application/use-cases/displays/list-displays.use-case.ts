import {
  type DisplayGroupRepository,
  type DisplayRepository,
  type DisplayStatus,
} from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  buildNowPlayingMap,
  listDisplaysWithFallback,
  withTelemetry,
} from "./shared";

export class ListDisplaysUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      displayGroupRepository: DisplayGroupRepository;
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input?: {
    page?: number;
    pageSize?: number;
    q?: string;
    status?: DisplayStatus;
    output?: string;
    groupIds?: string[];
    sortBy?: "name" | "status" | "location";
    sortDirection?: "asc" | "desc";
  }) {
    const now = new Date();
    const page = input?.page ?? 1;
    const pageSize = input?.pageSize ?? 20;
    const paged = await listDisplaysWithFallback({
      displayRepository: this.deps.displayRepository,
      displayGroupRepository: this.deps.displayGroupRepository,
      page,
      pageSize,
      q: input?.q,
      status: input?.status,
      output: input?.output,
      groupIds: input?.groupIds,
      sortBy: input?.sortBy,
      sortDirection: input?.sortDirection,
    });
    const displayIds = new Set(paged.items.map((display) => display.id));
    const schedulesForPage =
      displayIds.size === 0
        ? []
        : this.deps.scheduleRepository.listByDisplayIds != null
          ? await this.deps.scheduleRepository.listByDisplayIds([...displayIds])
          : (await this.deps.scheduleRepository.list()).filter((schedule) =>
              displayIds.has(schedule.displayId),
            );
    const nowPlayingByDisplayId = await buildNowPlayingMap({
      displays: paged.items,
      schedules: schedulesForPage,
      now,
      timeZone: this.deps.scheduleTimeZone ?? "UTC",
      playlistRepository: this.deps.playlistRepository,
    });
    const withStatus = paged.items.map((display) => ({
      ...withTelemetry(display),
      nowPlaying: nowPlayingByDisplayId.get(display.id) ?? null,
    }));
    return {
      items: withStatus,
      total: paged.total,
      page: paged.page,
      pageSize: paged.pageSize,
    };
  }
}
