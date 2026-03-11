import { type StreamEntry } from "#/bootstrap/workers/shared/stream-parsing";
import { env } from "#/env";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";

export const DLQ_REASON_INVALID_PAYLOAD = "invalid_payload";
export const DLQ_REASON_PROCESSING_FAILED = "processing_failed";

export const addToDlq = async (
  streamDlqName: string,
  input: {
    entry: StreamEntry;
    reason: string;
    error?: string;
  },
): Promise<void> => {
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
