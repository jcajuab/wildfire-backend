import { ValidationError } from "#/application/errors/validation";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import {
  type ContentIngestionJobRepository,
  type ContentIngestionQueue,
  type ContentJobEventPublisher,
} from "#/application/ports/content-jobs";
import { type CleanupFailureLogger } from "#/application/ports/observability";
import { type UserRepository } from "#/application/ports/rbac";
import { sha256Hex } from "#/domain/content/checksum";
import {
  buildContentFileKey,
  type ContentStatus,
  resolveContentType,
} from "#/domain/content/content";
import { toContentJobView } from "./content-job-view";
import { toContentView } from "./content-view";
import {
  ContentInUseError,
  InvalidContentTypeError,
  NotFoundError,
} from "./errors";

export class ReplaceContentFileUseCase {
  constructor(
    private readonly deps: {
      contentRepository: ContentRepository;
      contentStorage: ContentStorage;
      contentMetadataExtractor?: unknown;
      contentThumbnailGenerator?: unknown;
      contentIngestionJobRepository?: ContentIngestionJobRepository;
      contentIngestionQueue?: ContentIngestionQueue;
      contentJobEventPublisher?: ContentJobEventPublisher;
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
    const contentIngestionJobRepository = this.deps
      .contentIngestionJobRepository ?? {
      create: async (jobInput: {
        id: string;
        contentId: string;
        operation: "UPLOAD" | "REPLACE";
        status: "QUEUED" | "PROCESSING" | "SUCCEEDED" | "FAILED";
        createdById: string;
        errorMessage?: string | null;
      }) => ({
        id: jobInput.id,
        contentId: jobInput.contentId,
        operation: jobInput.operation,
        status: jobInput.status,
        errorMessage: jobInput.errorMessage ?? null,
        createdById: jobInput.createdById,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      }),
      findById: async () => null,
      update: async () => null,
    };
    const contentIngestionQueue = this.deps.contentIngestionQueue ?? {
      enqueue: async () => {},
    };
    const contentJobEventPublisher = this.deps.contentJobEventPublisher ?? {
      publish: () => {},
    };

    const existing = await this.deps.contentRepository.findById(input.id);
    if (!existing) {
      throw new NotFoundError("Content not found");
    }
    if (existing.type === "FLASH") {
      throw new InvalidContentTypeError("Flash content cannot replace files");
    }
    if (existing.status === "PROCESSING") {
      throw new ContentInUseError(
        "Cannot replace file while content is being processed.",
      );
    }

    const references =
      await this.deps.contentRepository.countPlaylistReferences(input.id);
    if (references > 0) {
      throw new ContentInUseError("Cannot replace a content item in use.");
    }

    const mimeType = input.file.type;
    const type = resolveContentType(mimeType);
    if (!type) {
      throw new InvalidContentTypeError("Unsupported content type");
    }
    if (existing.kind === "PAGE" && type !== "PDF") {
      throw new ValidationError(
        "PDF page content can only be replaced with PDF",
      );
    }

    const fileKey = buildContentFileKey({ id: input.id, type, mimeType });
    const buffer = await input.file.arrayBuffer();
    const checksum = await sha256Hex(buffer);
    const data = new Uint8Array(buffer);
    await this.deps.contentStorage.upload({
      key: fileKey,
      body: data,
      contentType: mimeType,
      contentLength: input.file.size,
    });

    const updated = await this.deps.contentRepository.update(input.id, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      type,
      status: "PROCESSING",
      fileKey,
      thumbnailKey: null,
      mimeType,
      fileSize: input.file.size,
      width: null,
      height: null,
      duration: null,
      checksum,
      ...(existing.kind === "ROOT" ? { pageCount: null } : {}),
    });
    if (!updated) {
      throw new NotFoundError("Content not found");
    }

    if (existing.fileKey !== fileKey) {
      await this.deps.contentStorage.delete(existing.fileKey).catch((error) => {
        this.deps.cleanupFailureLogger?.logContentCleanupFailure({
          route: "/content/:id/file",
          contentId: input.id,
          fileKey: existing.fileKey,
          failurePhase: "replace_cleanup_delete",
          error,
        });
      });
    }
    if (
      existing.thumbnailKey &&
      existing.thumbnailKey !== updated.thumbnailKey
    ) {
      await this.deps.contentStorage
        .delete(existing.thumbnailKey)
        .catch((error) => {
          this.deps.cleanupFailureLogger?.logContentCleanupFailure({
            route: "/content/:id/file",
            contentId: input.id,
            fileKey: existing.thumbnailKey ?? "",
            failurePhase: "replace_cleanup_delete",
            error,
          });
        });
    }

    let jobId: string | null = null;
    try {
      const job = await contentIngestionJobRepository.create({
        id: crypto.randomUUID(),
        contentId: updated.id,
        operation: "REPLACE",
        status: "QUEUED",
        createdById: updated.createdById,
      });
      jobId = job.id;
      await contentIngestionQueue.enqueue({
        jobId: job.id,
      });
      contentJobEventPublisher.publish({
        type: "queued",
        jobId: job.id,
        contentId: updated.id,
        timestamp: new Date().toISOString(),
        status: "QUEUED",
        message: "Content replacement queued for processing",
      });

      const creator = await this.deps.userRepository.findById(
        updated.createdById,
      );
      return {
        content: toContentView(updated, creator?.name ?? null),
        job: toContentJobView(job),
      };
    } catch (error) {
      await this.deps.contentRepository
        .update(updated.id, { status: "FAILED" })
        .catch(() => undefined);
      if (jobId) {
        const completedAt = new Date().toISOString();
        const message = error instanceof Error ? error.message : String(error);
        await contentIngestionJobRepository
          .update(jobId, {
            status: "FAILED",
            errorMessage: message,
            completedAt,
          })
          .catch(() => undefined);
        contentJobEventPublisher.publish({
          type: "failed",
          jobId,
          contentId: updated.id,
          timestamp: completedAt,
          status: "FAILED",
          errorMessage: message,
          message: "Content replacement ingestion job failed to enqueue",
        });
      }
      throw error;
    }
  }
}
