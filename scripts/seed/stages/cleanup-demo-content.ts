import { DEMO_CONTENT } from "../fixtures";
import { type SeedContext, type SeedStageResult } from "../stage-types";

const LEGACY_REMOVED_CONTENT_IDS = [
  "00000000-0000-0000-0000-00000000c002",
  "00000000-0000-0000-0000-00000000c021",
  "00000000-0000-0000-0000-00000000c022",
] as const;

const LEGACY_REMOVED_CONTENT_KEYS = [
  "demo/seed/content/demo-breakroom-notice.pdf",
  "demo/seed/content/demo-breakroom-notice-page-0001.pdf",
  "demo/seed/content/demo-breakroom-notice-page-0002.pdf",
] as const;

export async function runCleanupDemoContent(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  let deleted = 0;
  let skipped = 0;
  const notes: string[] = [];
  const cleanedIds = new Set<string>();

  const rootFixtures = DEMO_CONTENT.filter(
    (fixture) => fixture.parentContentId === null,
  );

  for (const fixture of rootFixtures) {
    const existing = await ctx.repos.contentRepository.findById(fixture.id);
    if (!existing) {
      skipped += 1;
      continue;
    }

    const childRecords = ctx.repos.contentRepository.findChildrenByParentIds
      ? await ctx.repos.contentRepository.findChildrenByParentIds(
          [existing.id],
          {
            includeExcluded: true,
          },
        )
      : [];

    if (ctx.args.dryRun) {
      deleted += childRecords.length + 1;
      cleanedIds.add(existing.id);
      for (const child of childRecords) {
        cleanedIds.add(child.id);
      }
      continue;
    }

    for (const child of childRecords) {
      await ctx.storage.contentStorage.delete(child.fileKey);
      if (child.thumbnailKey) {
        await ctx.storage.contentStorage.delete(child.thumbnailKey);
      }
      await ctx.repos.contentRepository.delete(child.id);
      cleanedIds.add(child.id);
      deleted += 1;
    }

    await ctx.storage.contentStorage.delete(existing.fileKey);
    if (existing.thumbnailKey) {
      await ctx.storage.contentStorage.delete(existing.thumbnailKey);
    }
    await ctx.repos.contentRepository.delete(existing.id);
    cleanedIds.add(existing.id);
    deleted += 1;
  }

  const childFixtures = DEMO_CONTENT.filter(
    (fixture) => fixture.parentContentId !== null,
  );
  for (const fixture of childFixtures) {
    if (cleanedIds.has(fixture.id)) {
      continue;
    }
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

  for (const legacyId of LEGACY_REMOVED_CONTENT_IDS) {
    if (cleanedIds.has(legacyId)) {
      continue;
    }
    const existing = await ctx.repos.contentRepository.findById(legacyId);
    if (!existing) {
      skipped += 1;
      continue;
    }
    if (ctx.args.dryRun) {
      deleted += 1;
      cleanedIds.add(legacyId);
      continue;
    }
    await ctx.storage.contentStorage.delete(existing.fileKey);
    if (existing.thumbnailKey) {
      await ctx.storage.contentStorage.delete(existing.thumbnailKey);
    }
    await ctx.repos.contentRepository.delete(existing.id);
    deleted += 1;
    cleanedIds.add(existing.id);
  }

  if (!ctx.args.dryRun) {
    for (const key of LEGACY_REMOVED_CONTENT_KEYS) {
      await ctx.storage.contentStorage.delete(key);
    }
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
