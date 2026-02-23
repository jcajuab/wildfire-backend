import {
  type ContentMetadataExtractor,
  type ContentRecord,
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

    await this.deps.contentStorage.upload({
      key: fileKey,
      body: data,
      contentType: mimeType,
      contentLength: input.file.size,
    });

    const generatedThumbnail = await this.deps.contentThumbnailGenerator
      .generate({
        type,
        mimeType,
        data,
      })
      .catch(() => null);
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
      } catch {
        thumbnailKey = null;
      }
    }

    let record: ContentRecord;
    try {
      record = await this.deps.contentRepository.create({
        id,
        title: input.title,
        type,
        status: "DRAFT",
        fileKey,
        thumbnailKey,
        checksum,
        mimeType,
        fileSize: input.file.size,
        width: extractedMetadata.width,
        height: extractedMetadata.height,
        duration: extractedMetadata.duration,
        createdById: user.id,
      });
    } catch (error) {
      const uploadedKeys = thumbnailKey ? [fileKey, thumbnailKey] : [fileKey];
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

    return toContentView(record, user.name);
  }
}
