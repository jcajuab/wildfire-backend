import { type DisplayRepository } from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { selectActiveScheduleByKind } from "#/domain/schedules/schedule";
import { NotFoundError } from "./errors";
import { withTelemetry } from "./shared";

export class GetDisplayUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input: { id: string }) {
    const display = await this.deps.displayRepository.findById(input.id);
    if (!display) throw new NotFoundError("Display not found");
    const now = new Date();
    const schedules = await this.deps.scheduleRepository.listByDisplay(
      display.id,
    );
    const active = selectActiveScheduleByKind(
      schedules,
      "PLAYLIST",
      now,
      this.deps.scheduleTimeZone ?? "UTC",
    );
    const playlist = active
      ? await this.deps.playlistRepository.findById(active.playlistId ?? "")
      : null;
    return {
      ...withTelemetry(display),
      nowPlaying: active
        ? {
            title: null,
            playlist: playlist?.name ?? null,
            progress: 0,
            duration: 0,
          }
        : null,
    };
  }
}
