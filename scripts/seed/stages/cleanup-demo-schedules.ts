import { DEMO_SCHEDULE_PREFIX } from "../constants";
import { type SeedContext, type SeedStageResult } from "../stage-types";

export async function runCleanupDemoSchedules(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  const schedules = await ctx.repos.scheduleRepository.list();
  const demoSchedules = schedules.filter((schedule) =>
    schedule.name.startsWith(DEMO_SCHEDULE_PREFIX),
  );

  if (demoSchedules.length === 0) {
    return {
      name: "cleanup-demo-schedules",
      created: 0,
      updated: 0,
      skipped: 1,
    };
  }

  if (ctx.args.dryRun) {
    return {
      name: "cleanup-demo-schedules",
      created: 0,
      updated: demoSchedules.length,
      skipped: 0,
      notes: ["Dry-run mode: schedules were not deleted."],
    };
  }

  let deleted = 0;
  for (const schedule of demoSchedules) {
    const removed = await ctx.repos.scheduleRepository.delete(schedule.id);
    if (removed) {
      deleted += 1;
    }
  }

  return {
    name: "cleanup-demo-schedules",
    created: 0,
    updated: deleted,
    skipped: 0,
  };
}
