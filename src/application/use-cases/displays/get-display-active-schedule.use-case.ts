import { type DisplayRepository } from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { selectActiveScheduleByKind } from "#/domain/schedules/schedule";
import { NotFoundError } from "./errors";

export class GetDisplayActiveScheduleUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      displayRepository: DisplayRepository;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input: { displayId: string; now: Date }) {
    await this.deps.displayRepository.touchSeen(input.displayId, input.now);
    const [display, schedules] = await Promise.all([
      this.deps.displayRepository.findById(input.displayId),
      this.deps.scheduleRepository.listByDisplay(input.displayId),
    ]);
    if (!display) throw new NotFoundError("Display not found");
    const active = selectActiveScheduleByKind(
      schedules,
      "PLAYLIST",
      input.now,
      this.deps.scheduleTimeZone ?? "UTC",
    );

    if (!active) return null;

    return {
      id: active.id,
      name: active.name,
      playlistId: active.playlistId,
      displayId: active.displayId,
      startDate: active.startDate,
      endDate: active.endDate,
      startTime: active.startTime,
      endTime: active.endTime,
      isActive: active.isActive,
      createdAt: active.createdAt,
      updatedAt: active.updatedAt,
      playlist: {
        id: active.playlistId ?? "",
        name:
          (await this.deps.playlistRepository.findById(active.playlistId ?? ""))
            ?.name ?? null,
      },
      display: { id: display.id, name: display.name },
    };
  }
}
