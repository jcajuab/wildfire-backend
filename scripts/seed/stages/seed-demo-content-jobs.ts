import { DEMO_CONTENT_JOBS, DEMO_USERS } from "../fixtures";
import { type SeedContext, type SeedStageResult } from "../stage-types";

const DRY_RUN_CONTENT_OWNER_ID = "dry-run:demo.content";

export async function runSeedDemoContentJobs(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  const contentOwner = await ctx.repos.userRepository.findByUsername(
    DEMO_USERS.find((user) => user.username === "demo.content")?.username ??
      "demo.content",
  );
  if (!contentOwner && !ctx.args.dryRun) {
    throw new Error(
      "Missing demo content owner user. Run seed-demo-rbac before seed-demo-content-jobs.",
    );
  }
  const contentOwnerId = contentOwner?.id ?? DRY_RUN_CONTENT_OWNER_ID;

  for (const fixture of DEMO_CONTENT_JOBS) {
    const content = await ctx.repos.contentRepository.findById(
      fixture.contentId,
    );
    if (!content && !ctx.args.dryRun) {
      throw new Error(
        `Missing content for seeded ingestion job: ${fixture.contentId}`,
      );
    }

    let existing = await ctx.repos.contentIngestionJobRepository.findById(
      fixture.id,
    );

    if (!existing) {
      created += 1;
      if (ctx.args.dryRun) {
        continue;
      }
      existing = await ctx.repos.contentIngestionJobRepository.create({
        id: fixture.id,
        contentId: fixture.contentId,
        operation: fixture.operation,
        status: fixture.status,
        errorMessage: fixture.errorMessage ?? null,
        createdById: contentOwnerId,
      });
    }

    if (
      (!ctx.args.dryRun && existing.contentId !== fixture.contentId) ||
      (!ctx.args.dryRun && existing.operation !== fixture.operation) ||
      (!ctx.args.dryRun && existing.createdById !== contentOwnerId)
    ) {
      throw new Error(
        `Seeded ingestion job does not match immutable fixture fields: ${fixture.id}`,
      );
    }

    const shouldUpdate =
      existing.status !== fixture.status ||
      (existing.errorMessage ?? null) !== (fixture.errorMessage ?? null) ||
      (existing.startedAt ?? null) !== (fixture.startedAt ?? null) ||
      (existing.completedAt ?? null) !== (fixture.completedAt ?? null);

    if (shouldUpdate) {
      updated += 1;
      if (!ctx.args.dryRun) {
        await ctx.repos.contentIngestionJobRepository.update(fixture.id, {
          status: fixture.status,
          errorMessage: fixture.errorMessage ?? null,
          startedAt: fixture.startedAt ?? null,
          completedAt: fixture.completedAt ?? null,
        });
      }
    } else {
      skipped += 1;
    }
  }

  return {
    name: "seed-demo-content-jobs",
    created,
    updated,
    skipped,
  };
}
