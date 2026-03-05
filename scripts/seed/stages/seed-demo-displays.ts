import { DEMO_DISPLAY_GROUPS, DEMO_DISPLAYS } from "../fixtures";
import { type SeedContext, type SeedStageResult } from "../stage-types";

const sameIdSet = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  left.length === right.length && left.every((value) => right.includes(value));

export async function runSeedDemoDisplays(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  const displayIdsBySlug = new Map<string, string>();

  for (const fixture of DEMO_DISPLAYS) {
    const existing = await ctx.repos.displayRepository.findBySlug(fixture.slug);
    if (!existing) {
      const createdDisplay = ctx.args.dryRun
        ? {
            id: `dry-run:${fixture.slug}`,
            status: "PROCESSING" as const,
          }
        : await ctx.repos.displayRepository.create({
            name: fixture.name,
            identifier: fixture.slug,
            displayFingerprint: fixture.displayFingerprint,
            location: fixture.location,
          });
      created += 1;
      displayIdsBySlug.set(fixture.slug, createdDisplay.id);
    } else {
      displayIdsBySlug.set(fixture.slug, existing.id);
      const shouldUpdate =
        existing.name !== fixture.name ||
        existing.displaySlug !== fixture.slug ||
        (existing.displayFingerprint ?? null) !== fixture.displayFingerprint ||
        (existing.location ?? null) !== fixture.location ||
        (existing.screenWidth ?? null) !== fixture.screenWidth ||
        (existing.screenHeight ?? null) !== fixture.screenHeight ||
        (existing.orientation ?? null) !== fixture.orientation ||
        (existing.outputType ?? null) !== fixture.displayOutput;
      if (shouldUpdate) {
        if (!ctx.args.dryRun) {
          await ctx.repos.displayRepository.update(existing.id, {
            name: fixture.name,
            identifier: fixture.slug,
            displayFingerprint: fixture.displayFingerprint,
            location: fixture.location,
            screenWidth: fixture.screenWidth,
            screenHeight: fixture.screenHeight,
            orientation: fixture.orientation,
            outputType: fixture.displayOutput,
          });
        }
        updated += 1;
      } else {
        skipped += 1;
      }
      if (existing.status !== fixture.status) {
        if (!ctx.args.dryRun) {
          await ctx.repos.displayRepository.setStatus({
            id: existing.id,
            status: fixture.status,
            at: new Date(),
          });
        }
        updated += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    if (!ctx.args.dryRun) {
      const createdDisplay = await ctx.repos.displayRepository.findBySlug(
        fixture.slug,
      );
      if (!createdDisplay) {
        throw new Error(`Failed to load seeded display: ${fixture.slug}`);
      }
      await ctx.repos.displayRepository.update(createdDisplay.id, {
        name: fixture.name,
        identifier: fixture.slug,
        displayFingerprint: fixture.displayFingerprint,
        location: fixture.location,
        screenWidth: fixture.screenWidth,
        screenHeight: fixture.screenHeight,
        orientation: fixture.orientation,
        outputType: fixture.displayOutput,
      });
      await ctx.repos.displayRepository.setStatus({
        id: createdDisplay.id,
        status: fixture.status,
        at: new Date(),
      });
      updated += 2;
      displayIdsBySlug.set(fixture.slug, createdDisplay.id);
    }
  }

  const groupByName = new Map(
    (await ctx.repos.displayGroupRepository.list()).map((group) => [
      group.name,
      group,
    ]),
  );
  const groupIdByName = new Map<string, string>();

  for (const groupFixture of DEMO_DISPLAY_GROUPS) {
    const existing = groupByName.get(groupFixture.name) ?? null;
    if (!existing) {
      if (!ctx.args.dryRun) {
        const createdGroup = await ctx.repos.displayGroupRepository.create({
          name: groupFixture.name,
          colorIndex: groupFixture.colorIndex,
        });
        groupIdByName.set(groupFixture.name, createdGroup.id);
      } else {
        groupIdByName.set(groupFixture.name, `dry-run:${groupFixture.name}`);
      }
      created += 1;
      continue;
    }

    groupIdByName.set(groupFixture.name, existing.id);
    if (existing.colorIndex !== groupFixture.colorIndex) {
      if (!ctx.args.dryRun) {
        await ctx.repos.displayGroupRepository.update(existing.id, {
          colorIndex: groupFixture.colorIndex,
        });
      }
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  const groups = await ctx.repos.displayGroupRepository.list();
  const currentGroupsByDisplayId = new Map<string, string[]>();
  for (const group of groups) {
    for (const displayId of group.displayIds) {
      const values = currentGroupsByDisplayId.get(displayId) ?? [];
      values.push(group.id);
      currentGroupsByDisplayId.set(displayId, values);
    }
  }

  for (const displayFixture of DEMO_DISPLAYS) {
    const displayId = displayIdsBySlug.get(displayFixture.slug);
    if (!displayId) {
      throw new Error(
        `Missing display id for demo group membership: ${displayFixture.slug}`,
      );
    }
    const nextGroupIds = DEMO_DISPLAY_GROUPS.filter((groupFixture) =>
      groupFixture.displaySlugs.includes(displayFixture.slug),
    )
      .map((groupFixture) => {
        const groupId = groupIdByName.get(groupFixture.name);
        if (!groupId) {
          throw new Error(
            `Missing group id for demo membership: ${groupFixture.name}`,
          );
        }
        return groupId;
      })
      .sort();
    const currentGroupIds = (
      currentGroupsByDisplayId.get(displayId) ?? []
    ).sort();
    if (!sameIdSet(currentGroupIds, nextGroupIds)) {
      if (!ctx.args.dryRun) {
        await ctx.repos.displayGroupRepository.setDisplayGroups(
          displayId,
          nextGroupIds,
        );
      }
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    name: "seed-demo-displays",
    created,
    updated,
    skipped,
  };
}
