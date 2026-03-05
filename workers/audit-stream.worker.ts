import { randomUUID } from "node:crypto";
import { type CreateAuditEventInput } from "#/application/ports/audit";
import { RecordAuditEventUseCase } from "#/application/use-cases/audit";
import { env } from "#/env";
import { closeDbConnection } from "#/infrastructure/db/client";
import { AuditEventDbRepository } from "#/infrastructure/db/repositories/audit-event.repo";
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

const streamName = env.REDIS_STREAM_AUDIT_NAME;
const streamGroup = env.REDIS_STREAM_AUDIT_GROUP;
const streamDlqName = `${env.REDIS_STREAM_AUDIT_NAME}:dlq`;
const consumerName = `audit-worker-${process.pid}-${randomUUID()}`;
const maxDeliveries = Math.max(1, env.REDIS_STREAM_MAX_DELIVERIES);

let isShuttingDown = false;

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
          operationName: "audit stream read",
        },
      );
      return parseStreamEntries(reply);
    } catch (error) {
      lastError = error;
      if (isShuttingDown || attempt >= maxAttempts) {
        break;
      }

      logger.warn(
        addErrorContext(
          {
            component: "audit",
            event: "audit.worker.read_retrying",
            streamName,
            streamGroup,
            consumerName,
            attempt,
            maxAttempts,
          },
          error,
        ),
        "audit stream read retrying",
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
        component: "audit",
        event: "audit.worker.read_failed",
        streamName,
        streamGroup,
        consumerName,
      },
      lastError,
    ),
    "audit stream read failed after retries",
  );

  return [];
};

const parseAuditEventPayload = (
  payload: string,
): CreateAuditEventInput | null => {
  try {
    const parsed = JSON.parse(payload) as Partial<CreateAuditEventInput>;
    if (parsed == null || typeof parsed !== "object") {
      return null;
    }

    if (typeof parsed.action !== "string" || parsed.action.length === 0) {
      return null;
    }

    if (typeof parsed.method !== "string" || parsed.method.length === 0) {
      return null;
    }

    if (typeof parsed.path !== "string" || parsed.path.length === 0) {
      return null;
    }

    if (typeof parsed.status !== "number" || !Number.isFinite(parsed.status)) {
      return null;
    }

    return parsed as CreateAuditEventInput;
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
        streamName,
        streamGroup,
      },
      "audit stream group created",
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
    String(Math.max(1000, env.AUDIT_QUEUE_CAPACITY)),
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

const processEntry = async (input: {
  entry: StreamEntry;
  recordAuditEvent: RecordAuditEventUseCase;
}): Promise<void> => {
  const event = parseAuditEventPayload(input.entry.payload);
  if (!event) {
    await addToDlq({
      entry: input.entry,
      reason: "invalid_payload",
    });
    await ackAndDeleteEntry(input.entry.id);
    return;
  }

  for (let attempt = 1; attempt <= maxDeliveries; attempt += 1) {
    try {
      await input.recordAuditEvent.execute(event);
      await ackAndDeleteEntry(input.entry.id);
      return;
    } catch (error) {
      const isLastAttempt = attempt >= maxDeliveries;
      if (!isLastAttempt) {
        logger.warn(
          addErrorContext(
            {
              component: "audit",
              event: "audit.worker.retry",
              attempt,
              maxAttempts: maxDeliveries,
              streamEntryId: input.entry.id,
              requestId: event.requestId,
              action: event.action,
            },
            error,
          ),
          "audit worker retrying stream entry",
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

      const message = error instanceof Error ? error.message : String(error);
      await addToDlq({
        entry: input.entry,
        reason: "processing_failed",
        error: message,
      });
      await ackAndDeleteEntry(input.entry.id);
      logger.error(
        addErrorContext(
          {
            component: "audit",
            event: "audit.worker.dead_letter",
            attempts: maxDeliveries,
            streamEntryId: input.entry.id,
            requestId: event.requestId,
            action: event.action,
          },
          error,
        ),
        "audit worker moved entry to DLQ",
      );
      return;
    }
  }
};

const runWorker = async (): Promise<void> => {
  const auditEventRepository = new AuditEventDbRepository();
  const recordAuditEvent = new RecordAuditEventUseCase({
    auditEventRepository,
  });

  await ensureGroup();

  logger.info(
    {
      component: "audit",
      event: "audit.worker.started",
      streamName,
      streamGroup,
      consumerName,
      blockMs: env.REDIS_STREAM_BLOCK_MS,
      batchSize: env.REDIS_STREAM_BATCH_SIZE,
      maxDeliveries,
    },
    "audit stream worker started",
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
        await processEntry({
          entry,
          recordAuditEvent,
        });
      }
    } catch (error) {
      if (isShuttingDown) {
        break;
      }
      logger.error(
        addErrorContext(
          {
            component: "audit",
            event: "audit.worker.loop_error",
            streamName,
            streamGroup,
            consumerName,
          },
          error,
        ),
        "audit stream worker loop failed",
      );
    }
  }

  logger.info(
    {
      component: "audit",
      event: "audit.worker.stopped",
      streamName,
      streamGroup,
      consumerName,
    },
    "audit stream worker stopped",
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
            component: "audit",
            event: "audit.worker.shutdown_failed",
          },
          error,
        ),
        "audit stream worker shutdown handler failed",
      );
    });
  });
}

if (import.meta.main) {
  let exitCode = 0;

  try {
    await runWorker();
  } catch (error) {
    exitCode = 1;
    logger.error(
      addErrorContext(
        {
          component: "audit",
          event: "audit.worker.terminated",
        },
        error,
      ),
      "audit stream worker terminated with error",
    );
  } finally {
    await handleShutdown();
  }

  process.exit(exitCode);
}
