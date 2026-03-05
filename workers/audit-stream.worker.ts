import { randomUUID } from "node:crypto";
import { type CreateAuditEventInput } from "#/application/ports/audit";
import { RecordAuditEventUseCase } from "#/application/use-cases/audit";
import { env } from "#/env";
import { closeDbConnection } from "#/infrastructure/db/client";
import { AuditEventDbRepository } from "#/infrastructure/db/repositories/audit-event.repo";
import { logger } from "#/infrastructure/observability/logger";
import {
  closeRedisClients,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";

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
    await redis.sendCommand([
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
  await redis.sendCommand(["XACK", streamName, streamGroup, entryId]);
  await redis.sendCommand(["XDEL", streamName, entryId]);
};

const addToDlq = async (input: {
  entry: StreamEntry;
  reason: string;
  error?: string;
}): Promise<void> => {
  const redis = await getRedisCommandClient();
  await redis.sendCommand([
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
          {
            err: error,
            attempt,
            maxAttempts: maxDeliveries,
            streamEntryId: input.entry.id,
            requestId: event.requestId,
            action: event.action,
          },
          "audit worker retrying stream entry",
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
        {
          err: error,
          attempts: maxDeliveries,
          streamEntryId: input.entry.id,
          requestId: event.requestId,
          action: event.action,
        },
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
      const redis = await getRedisCommandClient();
      const reply = await redis.sendCommand([
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
      ]);
      const entries = parseStreamEntries(reply);
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
        {
          err: error,
          streamName,
          streamGroup,
          consumerName,
        },
        "audit stream worker loop failed",
      );
    }
  }

  logger.info(
    {
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
    void handleShutdown();
  });
}

if (import.meta.main) {
  let exitCode = 0;

  try {
    await runWorker();
  } catch (error) {
    exitCode = 1;
    logger.error(
      {
        err: error,
      },
      "audit stream worker terminated with error",
    );
  } finally {
    await handleShutdown();
  }

  process.exit(exitCode);
}
