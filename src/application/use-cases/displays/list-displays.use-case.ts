import {
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
    const page = Math.max(1, input?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, input?.pageSize ?? 20));
    const offset = (page - 1) * pageSize;
    const paged = await listDisplaysWithFallback({
      displayRepository: this.deps.displayRepository,
      offset,
      limit: pageSize,
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
      page,
      pageSize,
    };
  }
}
