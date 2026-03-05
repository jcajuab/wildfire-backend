import { sha256Hex } from "#/domain/content/checksum";
import { DEMO_CONTENT, DEMO_USERS } from "../fixtures";
import { type SeedContext, type SeedStageResult } from "../stage-types";

const toArrayBuffer = (value: Uint8Array): ArrayBuffer =>
  Uint8Array.from(value).buffer;
const DRY_RUN_CONTENT_OWNER_ID = "dry-run:demo.content";
const DEMO_CONTENT_OWNER_USERNAME =
  DEMO_USERS.find((user) => user.username === "demo.content")?.username ??
  "demo.content";

export async function runSeedDemoContent(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  const contentOwner =
    (await ctx.repos.userRepository.findByUsername(
      DEMO_CONTENT_OWNER_USERNAME,
    )) ??
    (await ctx.repos.userRepository.list())[0] ??
    null;
  if (!contentOwner && !ctx.args.dryRun) {
    throw new Error(
      "Missing content owner user. Create at least one user before running db:seed.",
    );
  }

  if (!ctx.args.dryRun) {
    await ctx.storage.contentStorage.ensureBucketExists();
  }

  for (const fixture of DEMO_CONTENT) {
    const checksum = await sha256Hex(toArrayBuffer(fixture.body));
    const fileSize = fixture.body.byteLength;
    const existing = await ctx.repos.contentRepository.findById(fixture.id);

    if (!existing) {
      if (!ctx.args.dryRun) {
        await ctx.storage.contentStorage.upload({
          key: fixture.fileKey,
          body: fixture.body,
          contentType: fixture.mimeType,
          contentLength: fileSize,
        });
        await ctx.repos.contentRepository.create({
          id: fixture.id,
          title: fixture.title,
          type: fixture.type,
          kind: fixture.kind,
          status: "READY",
          fileKey: fixture.fileKey,
          thumbnailKey: null,
          parentContentId: fixture.parentContentId,
          pageNumber: fixture.pageNumber,
          pageCount: fixture.pageCount,
          isExcluded: fixture.isExcluded,
          checksum,
          mimeType: fixture.mimeType,
          fileSize,
          width: fixture.width,
          height: fixture.height,
          duration: fixture.duration,
          createdById: contentOwner?.id ?? DRY_RUN_CONTENT_OWNER_ID,
        });
      }
      created += 1;
      continue;
    }

    const shouldUploadFile =
      existing.fileKey !== fixture.fileKey ||
      existing.mimeType !== fixture.mimeType ||
      existing.fileSize !== fileSize ||
      existing.checksum !== checksum;

    const shouldUpdate =
      shouldUploadFile ||
      existing.title !== fixture.title ||
      existing.type !== fixture.type ||
      existing.kind !== fixture.kind ||
      existing.status !== "READY" ||
      (existing.parentContentId ?? null) !== fixture.parentContentId ||
      (existing.pageNumber ?? null) !== fixture.pageNumber ||
      (existing.pageCount ?? null) !== fixture.pageCount ||
      (existing.isExcluded ?? false) !== fixture.isExcluded ||
      (existing.width ?? null) !== fixture.width ||
      (existing.height ?? null) !== fixture.height ||
      (existing.duration ?? null) !== fixture.duration;

    if (!shouldUpdate) {
      skipped += 1;
      continue;
    }

    if (!ctx.args.dryRun) {
      if (shouldUploadFile) {
        await ctx.storage.contentStorage.upload({
          key: fixture.fileKey,
          body: fixture.body,
          contentType: fixture.mimeType,
          contentLength: fileSize,
        });
      }
      await ctx.repos.contentRepository.update(fixture.id, {
        title: fixture.title,
        type: fixture.type,
        kind: fixture.kind,
        status: "READY",
        fileKey: fixture.fileKey,
        thumbnailKey: null,
        parentContentId: fixture.parentContentId,
        pageNumber: fixture.pageNumber,
        pageCount: fixture.pageCount,
        isExcluded: fixture.isExcluded,
        checksum,
        mimeType: fixture.mimeType,
        fileSize,
        width: fixture.width,
        height: fixture.height,
        duration: fixture.duration,
      });
    }
    updated += 1;
  }

  return {
    name: "seed-demo-content",
    created,
    updated,
    skipped,
  };
}
