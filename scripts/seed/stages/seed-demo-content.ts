import { sha256Hex } from "#/domain/content/checksum";
import { DEMO_CONTENT, DEMO_USERS } from "../fixtures";
import { type SeedContext, type SeedStageResult } from "../stage-types";

const toArrayBuffer = (value: Uint8Array): ArrayBuffer =>
  Uint8Array.from(value).buffer;

export async function runSeedDemoContent(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  const contentOwner = await ctx.repos.userRepository.findByUsername(
    DEMO_USERS.find((user) => user.username === "demo.content")?.username ??
      "demo.content",
  );
  if (!contentOwner) {
    throw new Error(
      "Missing demo content owner user. Run seed-demo-rbac before seed-demo-content.",
    );
  }

  for (const fixture of DEMO_CONTENT) {
    const checksum = await sha256Hex(toArrayBuffer(fixture.body));
    const fileSize = fixture.body.byteLength;
    const existing = await ctx.repos.contentRepository.findById(fixture.id);

    if (!ctx.args.dryRun) {
      await ctx.storage.contentStorage.upload({
        key: fixture.fileKey,
        body: fixture.body,
        contentType: fixture.mimeType,
        contentLength: fileSize,
      });
    }

    if (!existing) {
      if (!ctx.args.dryRun) {
        await ctx.repos.contentRepository.create({
          id: fixture.id,
          title: fixture.title,
          type: fixture.type,
          status: "READY",
          fileKey: fixture.fileKey,
          thumbnailKey: null,
          checksum,
          mimeType: fixture.mimeType,
          fileSize,
          width: fixture.width,
          height: fixture.height,
          duration: fixture.duration,
          createdById: contentOwner.id,
        });
      }
      created += 1;
      continue;
    }

    const shouldUpdate =
      existing.title !== fixture.title ||
      existing.type !== fixture.type ||
      existing.status !== "READY" ||
      existing.fileKey !== fixture.fileKey ||
      (existing.thumbnailKey ?? null) !== null ||
      existing.checksum !== checksum ||
      existing.mimeType !== fixture.mimeType ||
      existing.fileSize !== fileSize ||
      (existing.width ?? null) !== fixture.width ||
      (existing.height ?? null) !== fixture.height ||
      (existing.duration ?? null) !== fixture.duration;

    if (shouldUpdate) {
      if (!ctx.args.dryRun) {
        await ctx.repos.contentRepository.update(fixture.id, {
          title: fixture.title,
          type: fixture.type,
          status: "READY",
          fileKey: fixture.fileKey,
          thumbnailKey: null,
          checksum,
          mimeType: fixture.mimeType,
          fileSize,
          width: fixture.width,
          height: fixture.height,
          duration: fixture.duration,
        });
      }
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    name: "seed-demo-content",
    created,
    updated,
    skipped,
  };
}
