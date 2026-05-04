import { type ContentRepository } from "#/application/ports/content";
import { type DisplayRepository } from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { NotFoundError } from "./errors";
import { toScheduleView } from "./schedule-view";
import { ensureScheduleVisibleToOwner } from "./shared";

export class GetScheduleUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      displayRepository: DisplayRepository;
    },
  ) {}

  async execute(input: { id: string; ownerId?: string }) {
    const schedule = await this.deps.scheduleRepository.findById(input.id);
    if (!schedule) throw new NotFoundError("Schedule not found");
    await ensureScheduleVisibleToOwner({
      ownerId: input.ownerId,
      schedule,
      playlistRepository: this.deps.playlistRepository,
      contentRepository: this.deps.contentRepository,
    });

    const [playlist, content, display] = await Promise.all([
      schedule.playlistId
        ? input.ownerId && this.deps.playlistRepository.findByIdForOwner
          ? this.deps.playlistRepository.findByIdForOwner(
              schedule.playlistId,
              input.ownerId,
            )
          : this.deps.playlistRepository.findById(schedule.playlistId)
        : Promise.resolve(null),
      schedule.contentId
        ? input.ownerId && this.deps.contentRepository.findByIdForOwner
          ? this.deps.contentRepository.findByIdForOwner(
              schedule.contentId,
              input.ownerId,
            )
          : this.deps.contentRepository.findById(schedule.contentId)
        : Promise.resolve(null),
      this.deps.displayRepository.findById(schedule.displayId),
    ]);

    if (
      (schedule.playlistId && !playlist) ||
      (schedule.contentId && !content)
    ) {
      throw new NotFoundError("Schedule not found");
    }

    return toScheduleView(schedule, playlist, content, display);
  }
}
