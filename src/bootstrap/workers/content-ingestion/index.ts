import { env } from "#/env";
import { closeDbConnection } from "#/infrastructure/db/client";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import { closeRedisClients } from "#/infrastructure/redis/client";
import { createEntryProcessor } from "./entry-processor";
import { processContentIngestionJob } from "./job-processor";
import { contentIngestionWorkerConfig } from "./runtime";
import { createContentIngestionStreamTransport } from "./stream-transport";

let isShuttingDown = false;

const streamTransport = createContentIngestionStreamTransport({
  config: contentIngestionWorkerConfig,
  isShuttingDown: () => isShuttingDown,
});

const entryProcessor = createEntryProcessor({
  config: contentIngestionWorkerConfig,
  processJob: processContentIngestionJob,
});

const runWorker = async (): Promise<void> => {
  await streamTransport.ensureGroup();

  logger.info(
    {
      component: "content",
      event: "content.ingestion.worker.started",
      streamName: contentIngestionWorkerConfig.streamName,
      streamGroup: contentIngestionWorkerConfig.streamGroup,
      consumerName: contentIngestionWorkerConfig.consumerName,
      blockMs: env.REDIS_STREAM_BLOCK_MS,
      batchSize: env.REDIS_STREAM_BATCH_SIZE,
      maxDeliveries: contentIngestionWorkerConfig.maxDeliveries,
    },
    "content ingestion worker started",
  );

  while (!isShuttingDown) {
    try {
      const entries = await streamTransport.readEntries();
      if (entries.length === 0) {
        continue;
      }

      for (const entry of entries) {
        if (isShuttingDown) {
          break;
        }
        await entryProcessor.processEntry({ entry });
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
            streamName: contentIngestionWorkerConfig.streamName,
            streamGroup: contentIngestionWorkerConfig.streamGroup,
            consumerName: contentIngestionWorkerConfig.consumerName,
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
      streamName: contentIngestionWorkerConfig.streamName,
      streamGroup: contentIngestionWorkerConfig.streamGroup,
      consumerName: contentIngestionWorkerConfig.consumerName,
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
