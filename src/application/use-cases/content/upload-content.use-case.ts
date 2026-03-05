import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import {
  type ContentIngestionJobRepository,
  type ContentIngestionQueue,
  type ContentJobEventPublisher,
} from "#/application/ports/content-jobs";
import { type UserRepository } from "#/application/ports/rbac";
import { sha256Hex } from "#/domain/content/checksum";
import {
  buildContentFileKey,
  resolveContentType,
} from "#/domain/content/content";
import { toContentJobView } from "./content-job-view";
import { toContentView } from "./content-view";
import { InvalidContentTypeError, NotFoundError } from "./errors";

export class UploadContentUseCase {
  constructor(
    private readonly deps: {
      contentRepository: ContentRepository;
      contentStorage: ContentStorage;
      contentMetadataExtractor?: unknown;
      contentThumbnailGenerator?: unknown;
      cleanupFailureLogger?: unknown;
      contentIngestionJobRepository?: ContentIngestionJobRepository;
      contentIngestionQueue?: ContentIngestionQueue;
      contentJobEventPublisher?: ContentJobEventPublisher;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input: { title: string; file: File; createdById: string }) {
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
    const created = await this.deps.contentRepository.create({
      id,
      title: input.title,
      type,
      kind: "ROOT",
      status: "PROCESSING",
      fileKey,
      thumbnailKey: null,
      parentContentId: null,
      pageNumber: null,
      pageCount: null,
      isExcluded: false,
      checksum,
      mimeType,
      fileSize: input.file.size,
      width: null,
      height: null,
      duration: null,
      createdById: user.id,
    });

    let uploaded = false;
    let jobId: string | null = null;
    try {
      await this.deps.contentStorage.upload({
        key: fileKey,
        body: data,
        contentType: mimeType,
        contentLength: input.file.size,
      });
      uploaded = true;

      const job = await contentIngestionJobRepository.create({
        id: crypto.randomUUID(),
        contentId: created.id,
        operation: "UPLOAD",
        status: "QUEUED",
        createdById: user.id,
      });
      jobId = job.id;
      await contentIngestionQueue.enqueue({
        jobId: job.id,
      });
      contentJobEventPublisher.publish({
        type: "queued",
        jobId: job.id,
        contentId: created.id,
        timestamp: new Date().toISOString(),
        status: "QUEUED",
        message: "Content upload queued for processing",
      });

      return {
        content: toContentView(created, user.name),
        job: toContentJobView(job),
      };
    } catch (error) {
      await this.deps.contentRepository
        .update(created.id, { status: "FAILED" })
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
          contentId: created.id,
          timestamp: completedAt,
          status: "FAILED",
          errorMessage: message,
          message: "Content upload ingestion job failed to enqueue",
        });
      }
      if (uploaded) {
        await this.deps.contentStorage.delete(fileKey).catch(() => undefined);
      }
      throw error;
    }
  }
}
