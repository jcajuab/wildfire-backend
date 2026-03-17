import {
  buildContentThumbnailKey,
  type ContentType,
  resolveContentType,
} from "#/domain/content/content";
import { publishContentJobEvent } from "#/infrastructure/content-jobs/content-job-events";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import { sleep } from "#/shared/retry";
import { contentIngestionContainer } from "./runtime";

const THUMBNAIL_MAX_RETRIES = 3;
const THUMBNAIL_RETRY_DELAY_MS = 500;

const runWithThumbnailRetries = async (input: {
  type: ContentType;
  mimeType: string;
  data: Uint8Array;
  generateThumbnail: (args: {
    type: ContentType;
    mimeType: string;
    data: Uint8Array;
  }) => Promise<Uint8Array | null>;
}): Promise<Uint8Array | null> => {
  for (let attempt = 1; attempt <= THUMBNAIL_MAX_RETRIES; attempt += 1) {
    try {
      const thumbnail = await input.generateThumbnail({
        type: input.type,
        mimeType: input.mimeType,
        data: input.data,
      });
      if (thumbnail) {
        return thumbnail;
      }
    } catch {
      if (attempt < THUMBNAIL_MAX_RETRIES) {
        await sleep(THUMBNAIL_RETRY_DELAY_MS);
      }
    }
  }
  return null;
};

export const processContentIngestionJob = async (
  jobId: string,
): Promise<void> => {
  const jobRepository =
    contentIngestionContainer.repositories.contentIngestionJobRepository;
  const contentRepository =
    contentIngestionContainer.repositories.contentRepository;
  const contentStorage = contentIngestionContainer.storage.contentStorage;
  const metadataExtractor =
    contentIngestionContainer.storage.contentMetadataExtractor;
  const thumbnailGenerator =
    contentIngestionContainer.storage.contentThumbnailGenerator;

  const job = await jobRepository.findById(jobId);
  if (!job) {
    return;
  }
  const startedAt = new Date().toISOString();
  await jobRepository.update(job.id, {
    status: "PROCESSING",
    errorMessage: null,
    startedAt,
    completedAt: null,
  });
  publishContentJobEvent({
    type: "processing",
    jobId: job.id,
    contentId: job.contentId,
    timestamp: startedAt,
    status: "PROCESSING",
    message: "Content ingestion started",
  });

  const content = await contentRepository.findById(job.contentId);
  if (!content) {
    throw new Error("Content not found for ingestion job");
  }

  const contentType = resolveContentType(content.mimeType);
  if (!contentType) {
    throw new Error("Unsupported content type for ingestion");
  }

  const data = await contentStorage.download?.(content.fileKey);
  if (!data) {
    throw new Error("Failed to download content file");
  }
  const metadata = await metadataExtractor.extract({
    type: contentType,
    mimeType: content.mimeType,
    data,
  });

  const generatedThumbnail = await runWithThumbnailRetries({
    type: contentType,
    mimeType: content.mimeType,
    data,
    generateThumbnail: (args) => thumbnailGenerator.generate(args),
  });

  let thumbnailKey: string | null = null;
  if (generatedThumbnail) {
    const candidateThumbnailKey = buildContentThumbnailKey(content.id);
    await contentStorage
      .upload({
        key: candidateThumbnailKey,
        body: generatedThumbnail,
        contentType: "image/jpeg",
        contentLength: generatedThumbnail.byteLength,
      })
      .then(() => {
        thumbnailKey = candidateThumbnailKey;
      })
      .catch((error) => {
        logger.warn(
          addErrorContext(
            {
              operation: "thumbnail_upload",
              key: candidateThumbnailKey,
              contentId: content.id,
            },
            error,
          ),
          "Failed to upload thumbnail",
        );
      });
  }

  if (content.thumbnailKey && content.thumbnailKey !== thumbnailKey) {
    await contentStorage.delete(content.thumbnailKey).catch((error) => {
      logger.warn(
        addErrorContext(
          {
            operation: "storage_cleanup",
            key: content.thumbnailKey,
            contentId: content.id,
          },
          error,
        ),
        "Failed to delete old thumbnail",
      );
    });
  }

  await contentRepository.update(content.id, {
    type: contentType,
    status: "READY",
    thumbnailKey,
    mimeType: content.mimeType,
    fileSize: data.byteLength,
    width: metadata.width,
    height: metadata.height,
    duration: metadata.duration,
  });

  const completedAt = new Date().toISOString();
  await jobRepository.update(job.id, {
    status: "SUCCEEDED",
    errorMessage: null,
    completedAt,
  });
  publishContentJobEvent({
    type: "succeeded",
    jobId: job.id,
    contentId: job.contentId,
    timestamp: completedAt,
    status: "SUCCEEDED",
    message: "Content ingestion completed",
  });
};
