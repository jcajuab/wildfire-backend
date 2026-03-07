import { type AdminDisplayLifecycleEventPublisher } from "#/application/ports/display-stream-events";
import { type DisplayRepository } from "#/application/ports/displays";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { deriveDisplayStatus } from "#/application/use-cases/displays";
import { selectActiveScheduleByKind } from "#/domain/schedules/schedule";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";

const DEFAULT_RECONCILE_INTERVAL_MS = 30_000;

export const startDisplayStatusReconciler = (input: {
  displayRepository: DisplayRepository;
  scheduleRepository: ScheduleRepository;
  lifecycleEventPublisher: AdminDisplayLifecycleEventPublisher;
  scheduleTimeZone?: string;
  intervalMs?: number;
}): (() => Promise<void>) => {
  let stopped = false;
  let running: Promise<void> | null = null;

  const run = async (): Promise<void> => {
    if (stopped || running !== null) return;

    const execution = (async () => {
      try {
        const now = new Date();
        const [allDisplays, schedules] = await Promise.all([
          input.displayRepository.list(),
          input.scheduleRepository.list(),
        ]);

        const schedulesByDisplayId = new Map<string, typeof schedules>();
        for (const schedule of schedules) {
          const existing = schedulesByDisplayId.get(schedule.displayId);
          if (existing) {
            existing.push(schedule);
            continue;
          }
          schedulesByDisplayId.set(schedule.displayId, [schedule]);
        }

        for (const display of allDisplays) {
          const activePlaylistSchedule = selectActiveScheduleByKind(
            schedulesByDisplayId.get(display.id) ?? [],
            "PLAYLIST",
            now,
            input.scheduleTimeZone ?? "UTC",
          );
          const activeFlashSchedule = selectActiveScheduleByKind(
            schedulesByDisplayId.get(display.id) ?? [],
            "FLASH",
            now,
            input.scheduleTimeZone ?? "UTC",
          );
          const nextStatus = deriveDisplayStatus({
            lastSeenAt: display.lastSeenAt ?? null,
            hasActivePlayback:
              activePlaylistSchedule !== null || activeFlashSchedule !== null,
            now,
          });

          if (nextStatus === display.status) {
            continue;
          }

          await input.displayRepository.setStatus({
            id: display.id,
            status: nextStatus,
            at: now,
          });
          input.lifecycleEventPublisher.publish({
            type: "display_status_changed",
            displayId: display.id,
            slug: display.slug,
            previousStatus: display.status,
            status: nextStatus,
            occurredAt: now.toISOString(),
          });
        }
      } catch (error) {
        logger.warn(
          addErrorContext(
            {
              component: "displays",
              event: "display-status-reconciler.failed",
            },
            error,
          ),
          "Display status reconciler iteration failed",
        );
      }
    })();
    running = execution;

    try {
      await execution;
    } finally {
      if (running === execution) {
        running = null;
      }
    }
  };

  const timer = setInterval(() => {
    if (!stopped) {
      void run();
    }
  }, input.intervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS);

  void run();

  return () => {
    stopped = true;
    clearInterval(timer);
    return running ?? Promise.resolve();
  };
};
