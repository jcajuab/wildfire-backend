import {
  type ContentMetadataExtractor,
  type ContentRecord,
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { type CleanupFailureLogger } from "#/application/ports/observability";
import { type UserRepository } from "#/application/ports/rbac";
import { sha256Hex } from "#/domain/content/checksum";
import {
  buildContentFileKey,
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

    let record: ContentRecord;
    try {
      record = await this.deps.contentRepository.create({
        id,
        title: input.title,
        type,
        status: "DRAFT",
        fileKey,
        checksum,
        mimeType,
        fileSize: input.file.size,
        width: extractedMetadata.width,
        height: extractedMetadata.height,
        duration: extractedMetadata.duration,
        createdById: user.id,
      });
    } catch (error) {
      // Clean up orphan storage file if DB insert fails
      try {
        await this.deps.contentStorage.delete(fileKey);
      } catch (cleanupError) {
        this.deps.cleanupFailureLogger?.logContentCleanupFailure({
          route: "/content",
          contentId: id,
          fileKey,
          failurePhase: "upload_rollback_delete",
          error: cleanupError,
        });
        throw new ContentStorageCleanupError(
          "Content creation failed and uploaded file cleanup did not complete.",
          { contentId: id, fileKey },
          { cause: cleanupError },
        );
      }
      throw error;
    }

    return toContentView(record, user.name);
  }
}
