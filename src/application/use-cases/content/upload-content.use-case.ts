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
  resolveContentType,
} from "#/domain/content/content";
import { toContentView } from "./content-view";
import {
  ContentMetadataExtractionError,
  ContentStorageCleanupError,
  InvalidContentTypeError,
  NotFoundError,
} from "./errors";

export class UploadContentUseCase {
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

  async execute(input: { title: string; file: File; createdById: string }) {
    const user = await this.deps.userRepository.findById(input.createdById);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    const mimeType = input.file.type;
    const type = resolveContentType(mimeType);
    if (!type) {
      throw new InvalidContentTypeError("Unsupported content type");
    }

    const id = crypto.randomUUID();
    const fileKey = buildContentFileKey({ id, type, mimeType });
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

    const record = await this.deps.contentRepository.create({
      id,
      title: input.title,
      type,
      status: "PROCESSING",
      fileKey,
      thumbnailKey: null,
      checksum,
      mimeType,
      fileSize: input.file.size,
      width: extractedMetadata.width,
      height: extractedMetadata.height,
      duration: extractedMetadata.duration,
      createdById: user.id,
    });

    const uploadedKeys: string[] = [];
    try {
      await this.deps.contentStorage.upload({
        key: fileKey,
        body: data,
        contentType: mimeType,
        contentLength: input.file.size,
      });
      uploadedKeys.push(fileKey);

      const THUMBNAIL_MAX_RETRIES = 3;
      const THUMBNAIL_RETRY_DELAY_MS = 500;
      let generatedThumbnail: Uint8Array | null = null;

      for (let attempt = 1; attempt <= THUMBNAIL_MAX_RETRIES; attempt++) {
        try {
          generatedThumbnail =
            await this.deps.contentThumbnailGenerator.generate({
              type,
              mimeType,
              data,
            });
          if (generatedThumbnail !== null) break;
        } catch {
          if (attempt < THUMBNAIL_MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, THUMBNAIL_RETRY_DELAY_MS));
          }
        }
      }

      let thumbnailKey: string | null = null;
      if (generatedThumbnail) {
        const candidateThumbnailKey = buildContentThumbnailKey(id);
        try {
          await this.deps.contentStorage.upload({
            key: candidateThumbnailKey,
            body: generatedThumbnail,
            contentType: "image/jpeg",
            contentLength: generatedThumbnail.byteLength,
          });
          thumbnailKey = candidateThumbnailKey;
          uploadedKeys.push(candidateThumbnailKey);
        } catch {
          thumbnailKey = null;
        }
      }

      const updatedRecord = await this.deps.contentRepository.update(
        record.id,
        {
          status: "READY",
          thumbnailKey,
        },
      );
      if (!updatedRecord) {
        throw new Error("Content not found while finalizing upload");
      }
    } catch (error) {
      const cleanupFailures: Array<{ key: string; error: unknown }> = [];
      for (const key of uploadedKeys) {
        try {
          await this.deps.contentStorage.delete(key);
        } catch (cleanupError) {
          cleanupFailures.push({ key, error: cleanupError });
          this.deps.cleanupFailureLogger?.logContentCleanupFailure({
            route: "/content",
            contentId: id,
            fileKey: key,
            failurePhase: "upload_rollback_delete",
            error: cleanupError,
          });
        }
      }

      await this.deps.contentRepository
        .update(record.id, { status: "FAILED" })
        .catch(() => undefined);

      if (cleanupFailures.length > 0) {
        const failure = cleanupFailures[0];
        if (!failure) {
          throw error;
        }
        throw new ContentStorageCleanupError(
          "Content creation failed and uploaded file cleanup did not complete.",
          { contentId: id, fileKey: failure.key },
          { cause: failure.error },
        );
      }

      throw error;
    }

    const readyRecord = await this.deps.contentRepository.findById(record.id);
    if (!readyRecord) {
      throw new NotFoundError("Content not found after upload");
    }
    return toContentView(readyRecord, user.name);
  }
}
