import { randomUUID } from "node:crypto";
import {
  createHttpContainer,
  type HttpContainer,
} from "#/bootstrap/http/container";
import { env } from "#/env";

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

export const contentIngestionContainer: HttpContainer = createHttpContainer({
  jwtSecret: env.JWT_SECRET,
  jwtIssuer: env.JWT_ISSUER,
  htshadowPath: env.HTSHADOW_PATH,
  minio: {
    endpoint: env.MINIO_ENDPOINT,
    port: env.MINIO_PORT,
    useSsl: env.MINIO_USE_SSL,
    bucket: env.MINIO_BUCKET,
    region: env.MINIO_REGION,
    rootUser: env.MINIO_ROOT_USER,
    rootPassword: env.MINIO_ROOT_PASSWORD,
    requestTimeoutMs: env.MINIO_REQUEST_TIMEOUT_MS,
  },
});
