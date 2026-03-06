import {
  DEMO_AUDIT_EVENTS,
  DEMO_DISPLAYS,
  DEMO_PLAYLISTS,
  DEMO_SCHEDULES,
} from "../fixtures";
import { type SeedContext, type SeedStageResult } from "../stage-types";

export async function runSeedDemoAuditLogs(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  let created = 0;
  const updated = 0;
  let skipped = 0;

  const usersByUsername = new Map(
    (await ctx.repos.userRepository.list()).map((user) => [
      user.username,
      user.id,
    ]),
  );
  const displaysBySlug = new Map<string, string>();
  for (const displayFixture of DEMO_DISPLAYS) {
    const display = await ctx.repos.displayRepository.findBySlug(
      displayFixture.slug,
    );
    if (display) {
      displaysBySlug.set(displayFixture.slug, display.id);
    }
  }
  const playlistsByName = new Map(
    (await ctx.repos.playlistRepository.list()).map((playlist) => [
      playlist.name,
      playlist.id,
    ]),
  );
  const schedulesByName = new Map(
    (await ctx.repos.scheduleRepository.list()).map((schedule) => [
      schedule.name,
      schedule.id,
    ]),
  );

  const supportedPlaylistNames = new Set(
    DEMO_PLAYLISTS.map((playlist) => playlist.name),
  );
  const supportedScheduleNames = new Set(
    DEMO_SCHEDULES.map((schedule) => schedule.name),
  );

  for (const fixture of DEMO_AUDIT_EVENTS) {
    const existing = await ctx.repos.auditLogRepository.list({
      offset: 0,
      limit: 10,
      requestId: fixture.requestId,
    });
    const hasExactEntry = existing.some(
      (entry) => (entry.requestId ?? null) === fixture.requestId,
    );
    if (hasExactEntry) {
      skipped += 1;
      continue;
    }

    const actorId =
      fixture.actorUserUsername != null
        ? (usersByUsername.get(fixture.actorUserUsername) ?? null)
        : fixture.actorDisplaySlug != null
          ? (displaysBySlug.get(fixture.actorDisplaySlug) ?? null)
          : null;
    const actorType =
      fixture.actorUserUsername != null
        ? "user"
        : fixture.actorDisplaySlug != null
          ? "display"
          : undefined;

    let resourceId: string | undefined;
    if (fixture.resourceDisplaySlug) {
      resourceId = displaysBySlug.get(fixture.resourceDisplaySlug);
    } else if (fixture.resourceContentId) {
      resourceId = fixture.resourceContentId;
    } else if (fixture.resourcePlaylistName) {
      if (!supportedPlaylistNames.has(fixture.resourcePlaylistName)) {
        throw new Error(
          `Unsupported demo audit playlist resource: ${fixture.resourcePlaylistName}`,
        );
      }
      resourceId = playlistsByName.get(fixture.resourcePlaylistName);
    } else if (fixture.resourceScheduleName) {
      if (!supportedScheduleNames.has(fixture.resourceScheduleName)) {
        throw new Error(
          `Unsupported demo audit schedule resource: ${fixture.resourceScheduleName}`,
        );
      }
      resourceId = schedulesByName.get(fixture.resourceScheduleName);
    }

    if (!ctx.args.dryRun) {
      await ctx.repos.auditLogRepository.create({
        occurredAt: new Date(),
        requestId: fixture.requestId,
        action: fixture.action,
        route: fixture.route,
        method: fixture.method,
        path: fixture.path,
        status: fixture.status,
        actorId: actorId ?? undefined,
        actorType,
        resourceId,
        resourceType: fixture.resourceType,
        ipAddress: "127.0.0.1",
        userAgent: "db-seed",
        metadataJson: JSON.stringify(fixture.metadata),
      });
    }
    created += 1;
  }

  return {
    name: "seed-demo-audit-logs",
    created,
    updated,
    skipped,
  };
}
