import { DEMO_DISPLAY_SLUG_PREFIX, DEMO_GROUP_PREFIX } from "../constants";
import { type SeedContext, type SeedStageResult } from "../stage-types";

export async function runCleanupDemoDisplays(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  const groups = await ctx.repos.displayGroupRepository.list();
  const displays = await ctx.repos.displayRepository.list();

  const demoGroups = groups.filter((group) =>
    group.name.startsWith(DEMO_GROUP_PREFIX),
  );
  const demoDisplays = displays.filter((display) =>
    display.slug.startsWith(DEMO_DISPLAY_SLUG_PREFIX),
  );

  const targetCount = demoGroups.length + demoDisplays.length;
  if (targetCount === 0) {
    return {
      name: "cleanup-demo-displays",
      created: 0,
      updated: 0,
      skipped: 1,
    };
  }

  if (ctx.args.dryRun) {
    return {
      name: "cleanup-demo-displays",
      created: 0,
      updated: targetCount,
      skipped: 0,
      notes: ["Dry-run mode: display groups and displays were not deleted."],
    };
  }

  let deleted = 0;
  for (const group of demoGroups) {
    const removed = await ctx.repos.displayGroupRepository.delete(group.id);
    if (removed) {
      deleted += 1;
    }
  }
  for (const display of demoDisplays) {
    const removed = await ctx.repos.displayRepository.delete(display.id);
    if (removed) {
      deleted += 1;
    }
  }

  return {
    name: "cleanup-demo-displays",
    created: 0,
    updated: deleted,
    skipped: 0,
  };
}
