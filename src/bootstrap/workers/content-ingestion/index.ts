import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { type ContentRecord } from "#/application/ports/content";
import { createHttpContainer } from "#/bootstrap/http/container";
import { sha256Hex } from "#/domain/content/checksum";
import {
  buildContentPageFileKey,
  buildContentThumbnailKey,
  resolveContentType,
} from "#/domain/content/content";
import { env } from "#/env";
import { publishContentJobEvent } from "#/infrastructure/content-jobs/content-job-events";
import { closeDbConnection } from "#/infrastructure/db/client";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import {
  closeRedisClients,
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";
import { calculateExponentialDelayMs, sleep } from "#/shared/retry";

interface StreamEntry {
  id: string;
  payload: string;
}

const streamName = env.REDIS_STREAM_CONTENT_INGEST_NAME;
const streamGroup = env.REDIS_STREAM_CONTENT_INGEST_GROUP;
const streamDlqName = `${env.REDIS_STREAM_CONTENT_INGEST_NAME}:dlq`;
const consumerName = `content-ingestion-worker-${process.pid}-${randomUUID()}`;
const maxDeliveries = Math.max(1, env.REDIS_STREAM_MAX_DELIVERIES);

const THUMBNAIL_MAX_RETRIES = 3;
const THUMBNAIL_RETRY_DELAY_MS = 500;

let isShuttingDown = false;

const isReadTimeoutError = (error: unknown): boolean =>
  error instanceof Error &&
  error.message.startsWith("content ingestion stream read timed out after");

const parseStreamEntries = (reply: unknown): StreamEntry[] => {
  if (!Array.isArray(reply)) {
    return [];
  }

  const entries: StreamEntry[] = [];

  for (const rawStream of reply) {
    if (!Array.isArray(rawStream) || rawStream.length < 2) {
      continue;
    }

    const rawEntries = rawStream[1];
    if (!Array.isArray(rawEntries)) {
      continue;
    }

    for (const rawEntry of rawEntries) {
      if (!Array.isArray(rawEntry) || rawEntry.length < 2) {
        continue;
      }

      const entryId = rawEntry[0];
      const fields = rawEntry[1];
      if (typeof entryId !== "string" || !Array.isArray(fields)) {
        continue;
      }

      let payload: string | null = null;
      for (let index = 0; index < fields.length; index += 2) {
        const field = fields[index];
        const value = fields[index + 1];
        if (field === "payload" && typeof value === "string") {
          payload = value;
          break;
        }
      }

      if (payload != null) {
        entries.push({
          id: entryId,
          payload,
        });
      }
    }
  }

  return entries;
};

const readStreamEntriesWithRetry = async (): Promise<StreamEntry[]> => {
  const maxAttempts = Math.max(1, Math.trunc(env.REDIS_STREAM_MAX_DELIVERIES));
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const redis = await getRedisCommandClient();
      const reply = await executeRedisCommand(
        redis,
        [
          "XREADGROUP",
          "GROUP",
          streamGroup,
          consumerName,
          "COUNT",
          String(env.REDIS_STREAM_BATCH_SIZE),
          "BLOCK",
          String(env.REDIS_STREAM_BLOCK_MS),
          "STREAMS",
          streamName,
          ">",
        ],
        {
          timeoutMs: Math.max(
            1_000,
            env.REDIS_STREAM_BLOCK_MS + env.WORKER_RETRY_MAX_DELAY_MS,
          ),
          operationName: "content ingestion stream read",
        },
      );
      return parseStreamEntries(reply);
    } catch (error) {
      if (isReadTimeoutError(error)) {
        return [];
      }
      lastError = error;
      if (isShuttingDown || attempt >= maxAttempts) {
        break;
      }

      logger.warn(
        addErrorContext(
          {
            component: "content",
            event: "content.ingestion.worker.read_retrying",
            streamName,
            streamGroup,
            consumerName,
            attempt,
            maxAttempts,
          },
          error,
        ),
        "content ingestion worker read retrying",
      );

      await sleep(
        calculateExponentialDelayMs({
          attempt,
          baseDelayMs: env.WORKER_RETRY_BASE_DELAY_MS,
          maxDelayMs: env.WORKER_RETRY_MAX_DELAY_MS,
        }),
      );
    }
  }

  logger.error(
    addErrorContext(
      {
        component: "content",
        event: "content.ingestion.worker.read_failed",
        streamName,
        streamGroup,
        consumerName,
      },
      lastError,
    ),
    "content ingestion worker read failed after retries",
  );

  return [];
};

const parseJobPayload = (
  payload: string,
): {
  jobId: string;
} | null => {
  try {
    const parsed = JSON.parse(payload) as {
      jobId?: unknown;
    };
    if (typeof parsed.jobId !== "string" || parsed.jobId.length === 0) {
      return null;
    }
    return { jobId: parsed.jobId };
  } catch {
    return null;
  }
};

const ensureGroup = async (): Promise<void> => {
  const redis = await getRedisCommandClient();
  try {
    await executeRedisCommand(redis, [
      "XGROUP",
      "CREATE",
      streamName,
      streamGroup,
      "0",
      "MKSTREAM",
    ]);
    logger.info(
      {
        component: "content",
        event: "content.ingestion.group.created",
        streamName,
        streamGroup,
      },
      "content ingestion stream group created",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("BUSYGROUP")) {
      return;
    }
    throw error;
  }
};

const ackAndDeleteEntry = async (entryId: string): Promise<void> => {
  const redis = await getRedisCommandClient();
  await executeRedisCommand(redis, ["XACK", streamName, streamGroup, entryId]);
  await executeRedisCommand(redis, ["XDEL", streamName, entryId]);
};

const addToDlq = async (input: {
  entry: StreamEntry;
  reason: string;
  error?: string;
}): Promise<void> => {
  const redis = await getRedisCommandClient();
  await executeRedisCommand(redis, [
    "XADD",
    streamDlqName,
    "MAXLEN",
    "~",
    String(Math.max(1000, env.CONTENT_INGEST_QUEUE_CAPACITY)),
    "*",
    "entryId",
    input.entry.id,
    "reason",
    input.reason,
    "error",
    input.error ?? "",
    "payload",
    input.entry.payload,
    "occurredAt",
    new Date().toISOString(),
  ]);
};

const toPositiveInt = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.max(1, Math.round(value));
};

const toArrayBuffer = (data: Uint8Array): ArrayBuffer => {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
};

const runWithThumbnailRetries = async (input: {
  type: "IMAGE" | "VIDEO" | "PDF";
  mimeType: string;
  data: Uint8Array;
  generateThumbnail: (args: {
    type: "IMAGE" | "VIDEO" | "PDF";
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

const container = createHttpContainer({
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

const processPdfChildren = async (input: {
  parent: ContentRecord;
  data: Uint8Array;
}): Promise<number> => {
  const parent = input.parent;
  const contentRepository = container.repositories.contentRepository;
  const contentStorage = container.storage.contentStorage;
  const thumbnailGenerator = container.storage.contentThumbnailGenerator;

  const existingChildren = contentRepository.findChildrenByParentIds
    ? await contentRepository.findChildrenByParentIds([parent.id], {
        includeExcluded: true,
      })
    : [];
  for (const existingChild of existingChildren) {
    await contentStorage.delete(existingChild.fileKey).catch(() => undefined);
    if (existingChild.thumbnailKey) {
      await contentStorage
        .delete(existingChild.thumbnailKey)
        .catch(() => undefined);
    }
  }
  if (existingChildren.length > 0) {
    if (contentRepository.deleteByParentId) {
      await contentRepository.deleteByParentId(parent.id);
    } else {
      for (const existingChild of existingChildren) {
        await contentRepository.delete(existingChild.id);
      }
    }
  }

  const sourcePdf = await PDFDocument.load(input.data);
  const pageCount = sourcePdf.getPageCount();
  for (let index = 0; index < pageCount; index += 1) {
    const pageNumber = index + 1;
    const childId = randomUUID();
    const pageDocument = await PDFDocument.create();
    const copiedPages = await pageDocument.copyPages(sourcePdf, [index]);
    const copiedPage = copiedPages[0];
    if (!copiedPage) {
      throw new Error(`Failed to copy PDF page ${String(pageNumber)}`);
    }
    pageDocument.addPage(copiedPage);
    const pageBytes = new Uint8Array(await pageDocument.save());
    const pageChecksum = await sha256Hex(toArrayBuffer(pageBytes));
    const pageFileKey = buildContentPageFileKey({
      parentId: parent.id,
      pageNumber,
    });
    await contentStorage.upload({
      key: pageFileKey,
      body: pageBytes,
      contentType: "application/pdf",
      contentLength: pageBytes.byteLength,
    });

    const generatedThumbnail = await runWithThumbnailRetries({
      type: "PDF",
      mimeType: "application/pdf",
      data: pageBytes,
      generateThumbnail: (args) => thumbnailGenerator.generate(args),
    });
    let thumbnailKey: string | null = null;
    if (generatedThumbnail) {
      const candidateThumbnailKey = buildContentThumbnailKey(childId);
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
        .catch(() => undefined);
    }

    const pageSize = copiedPage.getSize();
    await contentRepository.create({
      id: childId,
      title: `${parent.title} - Page ${String(pageNumber)}`,
      type: "PDF",
      kind: "PAGE",
      status: "READY",
      fileKey: pageFileKey,
      thumbnailKey,
      parentContentId: parent.id,
      pageNumber,
      pageCount,
      isExcluded: false,
      checksum: pageChecksum,
      mimeType: "application/pdf",
      fileSize: pageBytes.byteLength,
      width: toPositiveInt(pageSize.width),
      height: toPositiveInt(pageSize.height),
      duration: null,
      scrollPxPerSecond: null,
      createdById: parent.createdById,
    });
  }

  return pageCount;
};

const processJob = async (jobId: string): Promise<void> => {
  const jobRepository = container.repositories.contentIngestionJobRepository;
  const contentRepository = container.repositories.contentRepository;
  const contentStorage = container.storage.contentStorage;
  const metadataExtractor = container.storage.contentMetadataExtractor;
  const thumbnailGenerator = container.storage.contentThumbnailGenerator;

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

  const data = await contentStorage.download(content.fileKey);
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
      .catch(() => undefined);
  }

  if (content.thumbnailKey && content.thumbnailKey !== thumbnailKey) {
    await contentStorage.delete(content.thumbnailKey).catch(() => undefined);
  }

  let pageCount: number | null = null;
  if (content.kind === "ROOT" && contentType === "PDF") {
    pageCount = await processPdfChildren({
      parent: content,
      data,
    });
  } else if (content.kind === "ROOT") {
    const existingChildren = contentRepository.findChildrenByParentIds
      ? await contentRepository.findChildrenByParentIds([content.id], {
          includeExcluded: true,
        })
      : [];
    for (const child of existingChildren) {
      await contentStorage.delete(child.fileKey).catch(() => undefined);
      if (child.thumbnailKey) {
        await contentStorage.delete(child.thumbnailKey).catch(() => undefined);
      }
    }
    if (existingChildren.length > 0) {
      if (contentRepository.deleteByParentId) {
        await contentRepository.deleteByParentId(content.id);
      } else {
        for (const existingChild of existingChildren) {
          await contentRepository.delete(existingChild.id);
        }
      }
    }
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
    pageCount: content.kind === "ROOT" ? pageCount : content.pageCount,
    isExcluded: content.kind === "PAGE" ? content.isExcluded : false,
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

const processEntry = async (entry: StreamEntry): Promise<void> => {
  const payload = parseJobPayload(entry.payload);
  if (!payload) {
    await addToDlq({
      entry,
      reason: "invalid_payload",
    });
    await ackAndDeleteEntry(entry.id);
    return;
  }

  for (let attempt = 1; attempt <= maxDeliveries; attempt += 1) {
    try {
      await processJob(payload.jobId);
      await ackAndDeleteEntry(entry.id);
      return;
    } catch (error) {
      const isLastAttempt = attempt >= maxDeliveries;
      if (!isLastAttempt) {
        logger.warn(
          addErrorContext(
            {
              component: "content",
              event: "content.ingestion.worker.retry",
              streamName,
              streamGroup,
              consumerName,
              streamEntryId: entry.id,
              jobId: payload.jobId,
              attempt,
              maxAttempts: maxDeliveries,
            },
            error,
          ),
          "content ingestion worker retrying stream entry",
        );
        await sleep(
          calculateExponentialDelayMs({
            attempt,
            baseDelayMs: env.WORKER_RETRY_BASE_DELAY_MS,
            maxDelayMs: env.WORKER_RETRY_MAX_DELAY_MS,
          }),
        );
        continue;
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await container.repositories.contentIngestionJobRepository
        .findById(payload.jobId)
        .then(async (job) => {
          if (!job) {
            return;
          }
          await container.repositories.contentRepository
            .update(job.contentId, { status: "FAILED" })
            .catch(() => undefined);
          await container.repositories.contentIngestionJobRepository.update(
            job.id,
            {
              status: "FAILED",
              errorMessage,
              completedAt: new Date().toISOString(),
            },
          );
          publishContentJobEvent({
            type: "failed",
            jobId: job.id,
            contentId: job.contentId,
            timestamp: new Date().toISOString(),
            status: "FAILED",
            errorMessage,
            message: "Content ingestion failed",
          });
        });

      await addToDlq({
        entry,
        reason: "processing_failed",
        error: errorMessage,
      });
      await ackAndDeleteEntry(entry.id);
      logger.error(
        addErrorContext(
          {
            component: "content",
            event: "content.ingestion.worker.dead_letter",
            streamName,
            streamGroup,
            consumerName,
            streamEntryId: entry.id,
            jobId: payload.jobId,
            attempts: maxDeliveries,
          },
          error,
        ),
        "content ingestion worker moved entry to DLQ",
      );
      return;
    }
  }
};

const runWorker = async (): Promise<void> => {
  await ensureGroup();

  logger.info(
    {
      component: "content",
      event: "content.ingestion.worker.started",
      streamName,
      streamGroup,
      consumerName,
      blockMs: env.REDIS_STREAM_BLOCK_MS,
      batchSize: env.REDIS_STREAM_BATCH_SIZE,
      maxDeliveries,
    },
    "content ingestion worker started",
  );

  while (!isShuttingDown) {
    try {
      const entries = await readStreamEntriesWithRetry();
      if (entries.length === 0) {
        continue;
      }

      for (const entry of entries) {
        if (isShuttingDown) {
          break;
        }
        await processEntry(entry);
      }
    } catch (error) {
      if (isShuttingDown) {
        break;
      }
      logger.error(
        addErrorContext(
          {
            component: "content",
            event: "content.ingestion.worker.loop_error",
            streamName,
            streamGroup,
            consumerName,
          },
          error,
        ),
        "content ingestion worker loop failed",
      );
    }
  }

  logger.info(
    {
      component: "content",
      event: "content.ingestion.worker.stopped",
      streamName,
      streamGroup,
      consumerName,
    },
    "content ingestion worker stopped",
  );
};

const handleShutdown = async (): Promise<void> => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  await closeRedisClients();
  await closeDbConnection();
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void handleShutdown().catch((error) => {
      logger.error(
        addErrorContext(
          {
            component: "content",
            event: "content.ingestion.worker.shutdown_failed",
          },
          error,
        ),
        "content ingestion worker shutdown handler failed",
      );
    });
  });
}

export const runContentIngestionWorkerMain = async (): Promise<number> => {
  let exitCode = 0;

  try {
    await runWorker();
  } catch (error) {
    exitCode = 1;
    logger.error(
      addErrorContext(
        {
          component: "content",
          event: "content.ingestion.worker.terminated",
        },
        error,
      ),
      "content ingestion worker terminated with error",
    );
  } finally {
    await handleShutdown();
  }

  return exitCode;
};
