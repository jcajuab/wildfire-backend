import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";
import { calculateExponentialDelayMs, sleep } from "#/shared/retry";
import { type ContentIngestionWorkerConfig } from "./runtime";

export interface StreamEntry {
  id: string;
  payload: string;
}

export interface ContentIngestionStreamTransport {
  ensureGroup(): Promise<void>;
  readEntries(): Promise<StreamEntry[]>;
}

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

export const createContentIngestionStreamTransport = (input: {
  config: ContentIngestionWorkerConfig;
  isShuttingDown: () => boolean;
}): ContentIngestionStreamTransport => {
  const readEntries = async (): Promise<StreamEntry[]> => {
    const maxAttempts = Math.max(
      1,
      Math.trunc(env.REDIS_STREAM_MAX_DELIVERIES),
    );
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const redis = await getRedisCommandClient();
        const reply = await executeRedisCommand(
          redis,
          [
            "XREADGROUP",
            "GROUP",
            input.config.streamGroup,
            input.config.consumerName,
            "COUNT",
            String(env.REDIS_STREAM_BATCH_SIZE),
            "BLOCK",
            String(env.REDIS_STREAM_BLOCK_MS),
            "STREAMS",
            input.config.streamName,
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
        if (input.isShuttingDown() || attempt >= maxAttempts) {
          break;
        }

        logger.warn(
          addErrorContext(
            {
              component: "content",
              event: "content.ingestion.worker.read_retrying",
              streamName: input.config.streamName,
              streamGroup: input.config.streamGroup,
              consumerName: input.config.consumerName,
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
          streamName: input.config.streamName,
          streamGroup: input.config.streamGroup,
          consumerName: input.config.consumerName,
        },
        lastError,
      ),
      "content ingestion worker read failed after retries",
    );

    return [];
  };

  const ensureGroup = async (): Promise<void> => {
    const redis = await getRedisCommandClient();
    try {
      await executeRedisCommand(redis, [
        "XGROUP",
        "CREATE",
        input.config.streamName,
        input.config.streamGroup,
        "0",
        "MKSTREAM",
      ]);
      logger.info(
        {
          component: "content",
          event: "content.ingestion.group.created",
          streamName: input.config.streamName,
          streamGroup: input.config.streamGroup,
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

  return {
    ensureGroup,
    readEntries,
  };
};
