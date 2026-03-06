import { DEMO_DISPLAYS, DEMO_PLAYLISTS, DEMO_SCHEDULES } from "../fixtures";
import { type SeedContext, type SeedStageResult } from "../stage-types";

const toDryRunDisplayId = (slug: string): string => `dry-run:display:${slug}`;
const toDryRunPlaylistId = (name: string): string => `dry-run:playlist:${name}`;

export async function runSeedDemoSchedules(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  const displaysBySlug = new Map<string, string>();
  for (const displayFixture of DEMO_DISPLAYS) {
    const display = await ctx.repos.displayRepository.findBySlug(
      displayFixture.slug,
    );
    if (!display) {
      if (ctx.args.dryRun) {
        displaysBySlug.set(
          displayFixture.slug,
          toDryRunDisplayId(displayFixture.slug),
        );
        continue;
      }
      throw new Error(
        `Missing demo display for schedule seed: ${displayFixture.slug}`,
      );
    }
    displaysBySlug.set(displayFixture.slug, display.id);
  }

  const existingPlaylists = await ctx.repos.playlistRepository.list();
  const playlistsByName = new Map<string, string>();
  for (const playlistFixture of DEMO_PLAYLISTS) {
    const playlist = existingPlaylists.find(
      (candidate) => candidate.name === playlistFixture.name,
    );
    if (!playlist) {
      if (ctx.args.dryRun) {
        playlistsByName.set(
          playlistFixture.name,
          toDryRunPlaylistId(playlistFixture.name),
        );
        continue;
      }
      throw new Error(
        `Missing demo playlist for schedule seed: ${playlistFixture.name}`,
      );
    }
    playlistsByName.set(playlistFixture.name, playlist.id);
  }

  const schedulesByName = new Map(
    (await ctx.repos.scheduleRepository.list()).map((schedule) => [
      schedule.name,
      schedule,
    ]),
  );

  for (const fixture of DEMO_SCHEDULES) {
    const displayId = displaysBySlug.get(fixture.displaySlug);
    if (!displayId) {
      throw new Error(
        `Missing display id for schedule: ${fixture.displaySlug}`,
      );
    }
    const playlistId = playlistsByName.get(fixture.playlistName);
    if (!playlistId) {
      throw new Error(
        `Missing playlist id for schedule: ${fixture.playlistName}`,
      );
    }

    const existing = schedulesByName.get(fixture.name) ?? null;
    if (!existing) {
      if (!ctx.args.dryRun) {
        const createdSchedule = await ctx.repos.scheduleRepository.create({
          name: fixture.name,
          kind: "PLAYLIST",
          playlistId,
          contentId: null,
          displayId,
          startDate: fixture.startDate,
          endDate: fixture.endDate,
          startTime: fixture.startTime,
          endTime: fixture.endTime,
          priority: fixture.priority,
          isActive: fixture.isActive,
        });
        schedulesByName.set(fixture.name, createdSchedule);
      }
      created += 1;
      continue;
    }

    const shouldUpdate =
      existing.playlistId !== playlistId ||
      existing.displayId !== displayId ||
      (existing.startDate ?? null) !== fixture.startDate ||
      (existing.endDate ?? null) !== fixture.endDate ||
      existing.startTime !== fixture.startTime ||
      existing.endTime !== fixture.endTime ||
      existing.priority !== fixture.priority ||
      existing.isActive !== fixture.isActive;

    if (shouldUpdate) {
      if (!ctx.args.dryRun) {
        const updatedSchedule = await ctx.repos.scheduleRepository.update(
          existing.id,
          {
            kind: "PLAYLIST",
            playlistId,
            contentId: null,
            displayId,
            startDate: fixture.startDate,
            endDate: fixture.endDate,
            startTime: fixture.startTime,
            endTime: fixture.endTime,
            priority: fixture.priority,
            isActive: fixture.isActive,
          },
        );
        if (updatedSchedule) {
          schedulesByName.set(fixture.name, updatedSchedule);
        }
      }
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    name: "seed-demo-schedules",
    created,
    updated,
    skipped,
  };
}
