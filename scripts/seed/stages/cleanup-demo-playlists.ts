import { DEMO_PLAYLIST_PREFIX } from "../constants";
import { type SeedContext, type SeedStageResult } from "../stage-types";

export async function runCleanupDemoPlaylists(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  const playlists = await ctx.repos.playlistRepository.list();
  const demoPlaylists = playlists.filter((playlist) =>
    playlist.name.startsWith(DEMO_PLAYLIST_PREFIX),
  );

  if (demoPlaylists.length === 0) {
    return {
      name: "cleanup-demo-playlists",
      created: 0,
      updated: 0,
      skipped: 1,
    };
  }

  if (ctx.args.dryRun) {
    return {
      name: "cleanup-demo-playlists",
      created: 0,
      updated: demoPlaylists.length,
      skipped: 0,
      notes: ["Dry-run mode: playlists were not deleted."],
    };
  }

  let deleted = 0;
  for (const playlist of demoPlaylists) {
    const removed = await ctx.repos.playlistRepository.delete(playlist.id);
    if (removed) {
      deleted += 1;
    }
  }

  return {
    name: "cleanup-demo-playlists",
    created: 0,
    updated: deleted,
    skipped: 0,
  };
}
