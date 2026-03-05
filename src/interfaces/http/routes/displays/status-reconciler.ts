import { type DisplayRepository } from "#/application/ports/displays";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { deriveDisplayStatus } from "#/application/use-cases/displays";
import { selectActiveSchedule } from "#/domain/schedules/schedule";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import { publishAdminDisplayLifecycleEvent } from "./admin-lifecycle-events";

const DEFAULT_RECONCILE_INTERVAL_MS = 30_000;

export const startDisplayStatusReconciler = (input: {
  displayRepository: DisplayRepository;
  scheduleRepository: ScheduleRepository;
  scheduleTimeZone?: string;
  intervalMs?: number;
}): (() => void) => {
  let running = false;

  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
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
        const activeSchedule = selectActiveSchedule(
          schedulesByDisplayId.get(display.id) ?? [],
          now,
          input.scheduleTimeZone ?? "UTC",
        );
        const nextStatus = deriveDisplayStatus({
          lastSeenAt: display.lastSeenAt ?? null,
          hasActiveSchedule: activeSchedule !== null,
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
        publishAdminDisplayLifecycleEvent({
          type: "display_status_changed",
          displayId: display.id,
          displaySlug: display.displaySlug,
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
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void run();
  }, input.intervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS);

  void run();

  return () => {
    clearInterval(timer);
  };
};
