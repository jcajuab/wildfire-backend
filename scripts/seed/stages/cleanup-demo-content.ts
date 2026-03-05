import { DEMO_CONTENT } from "../fixtures";
import { type SeedContext, type SeedStageResult } from "../stage-types";

export async function runCleanupDemoContent(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  let deleted = 0;
  let skipped = 0;
  const notes: string[] = [];

  for (const fixture of DEMO_CONTENT) {
    const existing = await ctx.repos.contentRepository.findById(fixture.id);
    if (!existing) {
      skipped += 1;
      continue;
    }

    if (ctx.args.dryRun) {
      deleted += 1;
      continue;
    }

    await ctx.storage.contentStorage.delete(existing.fileKey);
    if (existing.thumbnailKey) {
      await ctx.storage.contentStorage.delete(existing.thumbnailKey);
    }
    await ctx.repos.contentRepository.delete(existing.id);
    deleted += 1;
  }

  if (ctx.args.dryRun && deleted > 0) {
    notes.push("Dry-run mode: content objects and rows were not deleted.");
  }

  return {
    name: "cleanup-demo-content",
    created: 0,
    updated: deleted,
    skipped,
    notes,
  };
}
