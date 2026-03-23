import {
  type AdminDisplayLifecycleEventPublisher,
  type DisplayStreamEventPublisher,
} from "#/application/ports/display-stream-events";
import { type DisplayRepository } from "#/application/ports/displays";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { deriveDisplayStatus } from "#/application/use-cases/displays/display-status";
import { selectActiveScheduleByKind } from "#/domain/schedules/schedule";
import { type DisplayHeartbeatStore } from "#/infrastructure/redis/display-heartbeat.store";

export class RecordDisplayHeartbeatUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      scheduleRepository: ScheduleRepository;
      displayEventPublisher: DisplayStreamEventPublisher;
      lifecycleEventPublisher: AdminDisplayLifecycleEventPublisher;
      displayHeartbeatStore: DisplayHeartbeatStore;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input: { displayId: string; now?: Date }): Promise<void> {
    const now = input.now ?? new Date();
    await this.deps.displayHeartbeatStore.touchSeen(input.displayId, now);

    const [display, schedules] = await Promise.all([
      this.deps.displayRepository.findById(input.displayId),
      this.deps.scheduleRepository.listByDisplay(input.displayId),
    ]);

    if (display) {
      const activePlaylistSchedule = selectActiveScheduleByKind(
        schedules,
        "PLAYLIST",
        now,
        this.deps.scheduleTimeZone ?? "UTC",
      );
      const activeFlashSchedule = selectActiveScheduleByKind(
        schedules,
        "FLASH",
        now,
        this.deps.scheduleTimeZone ?? "UTC",
      );
      const nextStatus = deriveDisplayStatus({
        lastSeenAt: now.toISOString(),
        hasActivePlayback:
          activePlaylistSchedule !== null || activeFlashSchedule !== null,
        now,
      });

      if (display.status !== nextStatus) {
        await this.deps.displayRepository.setStatus({
          id: display.id,
          status: nextStatus,
          at: now,
        });
        this.deps.lifecycleEventPublisher.publish({
          type: "display_status_changed",
          displayId: display.id,
          slug: display.slug,
          previousStatus: display.status,
          status: nextStatus,
          occurredAt: now.toISOString(),
        });
      }
    }

    this.deps.displayEventPublisher.publish({
      type: "manifest_updated",
      displayId: input.displayId,
      reason: "heartbeat",
      timestamp: now.toISOString(),
    });
  }
}
