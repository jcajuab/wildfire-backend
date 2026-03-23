import { randomUUID } from "node:crypto";
import {
  type ContentMetadataExtractor,
  type ContentRepository,
  type ContentStorage,
  type ContentThumbnailGenerator,
} from "#/application/ports/content";
import { type ContentIngestionJobRepository } from "#/application/ports/content-jobs";
import { env } from "#/env";
import { ContentDbRepository } from "#/infrastructure/db/repositories/content.repo";
import { ContentIngestionJobDbRepository } from "#/infrastructure/db/repositories/content-job.repo";
import { DefaultContentMetadataExtractor } from "#/infrastructure/media/content-metadata.extractor";
import { DefaultContentThumbnailGenerator } from "#/infrastructure/media/content-thumbnail.generator";
import { S3ContentStorage } from "#/infrastructure/storage/s3-content.storage";

export interface ContentIngestionWorkerConfig {
  streamName: string;
  streamGroup: string;
  streamDlqName: string;
  consumerName: string;
  maxDeliveries: number;
}

export const contentIngestionWorkerConfig: ContentIngestionWorkerConfig = {
  streamName: env.REDIS_STREAM_CONTENT_INGEST_NAME,
  streamGroup: env.REDIS_STREAM_CONTENT_INGEST_GROUP,
  streamDlqName: `${env.REDIS_STREAM_CONTENT_INGEST_NAME}:dlq`,
  consumerName: `content-ingestion-worker-${process.pid}-${randomUUID()}`,
  maxDeliveries: Math.max(1, env.REDIS_STREAM_MAX_DELIVERIES),
};

const minioEndpoint = `${env.MINIO_USE_SSL ? "https" : "http"}://${env.MINIO_ENDPOINT}:${env.MINIO_PORT}`;

export const contentIngestionContainer: {
  repositories: {
    contentRepository: ContentRepository;
    contentIngestionJobRepository: ContentIngestionJobRepository;
  };
  storage: {
    contentStorage: ContentStorage;
    contentMetadataExtractor: ContentMetadataExtractor;
    contentThumbnailGenerator: ContentThumbnailGenerator;
  };
} = {
  repositories: {
    contentRepository: new ContentDbRepository(),
    contentIngestionJobRepository: new ContentIngestionJobDbRepository(),
  },
  storage: {
    contentStorage: new S3ContentStorage({
      bucket: env.MINIO_BUCKET,
      region: env.MINIO_REGION,
      endpoint: minioEndpoint,
      accessKeyId: env.MINIO_ROOT_USER,
      secretAccessKey: env.MINIO_ROOT_PASSWORD,
      requestTimeoutMs: env.MINIO_REQUEST_TIMEOUT_MS,
    }),
    contentMetadataExtractor: new DefaultContentMetadataExtractor(),
    contentThumbnailGenerator: new DefaultContentThumbnailGenerator(),
  },
};
