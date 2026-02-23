import {
  type ContentMetadataExtractor,
  type ContentRepository,
  type ContentStorage,
  type ContentThumbnailGenerator,
} from "#/application/ports/content";
import { type CleanupFailureLogger } from "#/application/ports/observability";
import { type UserRepository } from "#/application/ports/rbac";
import { sha256Hex } from "#/domain/content/checksum";
import {
  buildContentFileKey,
  buildContentThumbnailKey,
  type ContentStatus,
  resolveContentType,
} from "#/domain/content/content";
import { toContentView } from "./content-view";
import {
  ContentInUseError,
  ContentMetadataExtractionError,
  ContentStorageCleanupError,
  InvalidContentTypeError,
  NotFoundError,
} from "./errors";

export class ReplaceContentFileUseCase {
  constructor(
    private readonly deps: {
      contentRepository: ContentRepository;
      contentStorage: ContentStorage;
      contentMetadataExtractor: ContentMetadataExtractor;
      contentThumbnailGenerator: ContentThumbnailGenerator;
      userRepository: UserRepository;
      cleanupFailureLogger?: CleanupFailureLogger;
    },
  ) {}

  async execute(input: {
    id: string;
    file: File;
    title?: string;
    status?: ContentStatus;
  }) {
    const existing = await this.deps.contentRepository.findById(input.id);
    if (!existing) {
      throw new NotFoundError("Content not found");
    }
    if (existing.status !== "DRAFT") {
      throw new ContentInUseError(
        "Cannot replace file when content is in use. Set to Draft first.",
      );
    }

    const mimeType = input.file.type;
    const type = resolveContentType(mimeType);
    if (!type) {
      throw new InvalidContentTypeError("Unsupported content type");
    }

    const fileKey = buildContentFileKey({ id: input.id, type, mimeType });
    const buffer = await input.file.arrayBuffer();
    const checksum = await sha256Hex(buffer);
    const data = new Uint8Array(buffer);

    let extractedMetadata: Awaited<
      ReturnType<ContentMetadataExtractor["extract"]>
    >;
    try {
      extractedMetadata = await this.deps.contentMetadataExtractor.extract({
        type,
        mimeType,
        data,
      });
    } catch (error) {
      throw new ContentMetadataExtractionError(
        "Failed to extract content metadata",
        { cause: error },
      );
    }

    await this.deps.contentStorage.upload({
      key: fileKey,
      body: data,
      contentType: mimeType,
      contentLength: input.file.size,
    });

    const THUMBNAIL_MAX_RETRIES = 3;
    const THUMBNAIL_RETRY_DELAY_MS = 500;

    let generatedThumbnail: Uint8Array | null = null;
    for (let attempt = 1; attempt <= THUMBNAIL_MAX_RETRIES; attempt++) {
      try {
        generatedThumbnail = await this.deps.contentThumbnailGenerator.generate(
          {
            type,
            mimeType,
            data,
          },
        );
        if (generatedThumbnail !== null) break;
      } catch {
        if (attempt < THUMBNAIL_MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, THUMBNAIL_RETRY_DELAY_MS));
        }
      }
    }
    let thumbnailKey: string | null = null;

    if (generatedThumbnail) {
      const candidateThumbnailKey = buildContentThumbnailKey(input.id);
      try {
        await this.deps.contentStorage.upload({
          key: candidateThumbnailKey,
          body: generatedThumbnail,
          contentType: "image/jpeg",
          contentLength: generatedThumbnail.byteLength,
        });
        thumbnailKey = candidateThumbnailKey;
      } catch {
        thumbnailKey = null;
      }
    }

    const protectedKeys = new Set(
      thumbnailKey ? [fileKey, thumbnailKey] : [fileKey],
    );
    const keysToDelete = [existing.fileKey, existing.thumbnailKey]
      .filter((key): key is string => Boolean(key))
      .filter((key) => !protectedKeys.has(key));

    for (const key of keysToDelete) {
      try {
        await this.deps.contentStorage.delete(key);
      } catch (cleanupError) {
        this.deps.cleanupFailureLogger?.logContentCleanupFailure({
          route: "/content/:id/file",
          contentId: input.id,
          fileKey: key,
          failurePhase: "replace_cleanup_delete",
          error: cleanupError,
        });
        throw new ContentStorageCleanupError(
          "Content file was replaced but previous file cleanup did not complete.",
          { contentId: input.id, fileKey: key },
          { cause: cleanupError },
        );
      }
    }

    const updated = await this.deps.contentRepository.update(input.id, {
      fileKey,
      thumbnailKey,
      type,
      mimeType,
      fileSize: input.file.size,
      width: extractedMetadata.width,
      height: extractedMetadata.height,
      duration: extractedMetadata.duration,
      checksum,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    });
    if (!updated) {
      throw new NotFoundError("Content not found");
    }

    const creator = await this.deps.userRepository.findById(
      updated.createdById,
    );
    return toContentView(updated, creator?.name ?? null);
  }
}
