import { type ContentRepository } from "#/application/ports/content";
import {
  type AdminDisplayLifecycleEventPublisher,
  type DisplayStreamEventPublisher,
} from "#/application/ports/display-stream-events";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { NotFoundError } from "./errors";
import { ensureScheduleVisibleToOwner } from "./shared";

export class DeleteScheduleUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
      adminLifecycleEventPublisher?: AdminDisplayLifecycleEventPublisher;
    },
  ) {}

  async execute(input: { id: string; ownerId?: string }) {
    const existing = await this.deps.scheduleRepository.findById(input.id);
    if (!existing) throw new NotFoundError("Schedule not found");
    await ensureScheduleVisibleToOwner({
      ownerId: input.ownerId,
      schedule: existing,
      playlistRepository: this.deps.playlistRepository,
      contentRepository: this.deps.contentRepository,
    });

    const deleted = await this.deps.scheduleRepository.delete(input.id);
    if (!deleted) throw new NotFoundError("Schedule not found");

    if (existing.playlistId) {
      const remaining = await this.deps.scheduleRepository.countByPlaylistId(
        existing.playlistId,
      );
      if (remaining === 0) {
        await this.deps.playlistRepository.updateStatus(
          existing.playlistId,
          "DRAFT",
        );
        this.deps.adminLifecycleEventPublisher?.publish({
          type: "playlist_status_changed",
          playlistId: existing.playlistId,
          status: "DRAFT",
          occurredAt: new Date().toISOString(),
        });
      }
    }
    this.deps.displayEventPublisher?.publish({
      type: "schedule_updated",
      displayId: existing.displayId,
      reason: "schedule_deleted",
    });
  }
}
