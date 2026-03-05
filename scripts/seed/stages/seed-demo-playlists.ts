import { DEMO_PLAYLISTS, DEMO_USERS } from "../fixtures";
import { type SeedContext, type SeedStageResult } from "../stage-types";

const DRY_RUN_PLAYLIST_OWNER_ID = "dry-run:demo.content";

const sameItems = (
  left: Array<{ contentId: string; sequence: number; duration: number }>,
  right: Array<{ contentId: string; sequence: number; duration: number }>,
): boolean =>
  left.length === right.length &&
  left.every((leftItem, index) => {
    const rightItem = right[index];
    if (!rightItem) {
      return false;
    }
    return (
      leftItem.contentId === rightItem.contentId &&
      leftItem.sequence === rightItem.sequence &&
      leftItem.duration === rightItem.duration
    );
  });

export async function runSeedDemoPlaylists(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  const playlistOwner = await ctx.repos.userRepository.findByUsername(
    DEMO_USERS.find((user) => user.username === "demo.content")?.username ??
      "demo.content",
  );
  if (!playlistOwner && !ctx.args.dryRun) {
    throw new Error(
      "Missing demo playlist owner user. Run seed-demo-rbac before seed-demo-playlists.",
    );
  }
  const playlistOwnerId = playlistOwner?.id ?? DRY_RUN_PLAYLIST_OWNER_ID;

  const existingPlaylists = await ctx.repos.playlistRepository.list();
  const playlistsByName = new Map(
    existingPlaylists.map((playlist) => [playlist.name, playlist]),
  );

  for (const fixture of DEMO_PLAYLISTS) {
    let playlist = playlistsByName.get(fixture.name) ?? null;
    if (!playlist) {
      if (!ctx.args.dryRun) {
        playlist = await ctx.repos.playlistRepository.create({
          name: fixture.name,
          description: fixture.description,
          createdById: playlistOwnerId,
        });
      } else {
        playlist = {
          id: `dry-run:${fixture.name}`,
          name: fixture.name,
          description: fixture.description,
          status: "DRAFT",
          createdById: playlistOwnerId,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        };
      }
      playlistsByName.set(fixture.name, playlist);
      created += 1;
    } else {
      const shouldUpdateBase = playlist.description !== fixture.description;
      if (shouldUpdateBase) {
        if (!ctx.args.dryRun) {
          const updatedPlaylist = await ctx.repos.playlistRepository.update(
            playlist.id,
            {
              description: fixture.description,
            },
          );
          if (updatedPlaylist) {
            playlist = updatedPlaylist;
            playlistsByName.set(fixture.name, updatedPlaylist);
          }
        }
        updated += 1;
      } else {
        skipped += 1;
      }
    }

    if ((playlist.status ?? "DRAFT") !== fixture.status) {
      if (!ctx.args.dryRun) {
        await ctx.repos.playlistRepository.updateStatus(
          playlist.id,
          fixture.status,
        );
      }
      updated += 1;
    } else {
      skipped += 1;
    }

    const existingItems = await ctx.repos.playlistRepository.listItems(
      playlist.id,
    );
    const currentItems = existingItems
      .map((item) => ({
        contentId: item.contentId,
        sequence: item.sequence,
        duration: item.duration,
      }))
      .sort((a, b) => a.sequence - b.sequence);
    const nextItems = [...fixture.items].sort(
      (a, b) => a.sequence - b.sequence,
    );

    if (!sameItems(currentItems, nextItems)) {
      if (!ctx.args.dryRun) {
        for (const item of existingItems) {
          await ctx.repos.playlistRepository.deleteItem(item.id);
        }
        for (const item of nextItems) {
          await ctx.repos.playlistRepository.addItem({
            playlistId: playlist.id,
            contentId: item.contentId,
            sequence: item.sequence,
            duration: item.duration,
          });
        }
      }
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    name: "seed-demo-playlists",
    created,
    updated,
    skipped,
  };
}
