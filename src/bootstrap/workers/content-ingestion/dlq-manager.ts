import { env } from "#/env";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";
import { type StreamEntry } from "./stream-transport";

export interface DlqManager {
  addToDlq(input: {
    entry: StreamEntry;
    reason: string;
    error?: string;
  }): Promise<void>;
}

export const DLQ_REASON_INVALID_PAYLOAD = "invalid_payload";
export const DLQ_REASON_PROCESSING_FAILED = "processing_failed";

export const createDlqManager = (input: {
  streamName: string;
  streamDlqName: string;
}): DlqManager => {
  const addToDlq = async (dlqInput: {
    entry: StreamEntry;
    reason: string;
    error?: string;
  }): Promise<void> => {
    const redis = await getRedisCommandClient();
    await executeRedisCommand(redis, [
      "XADD",
      input.streamDlqName,
      "MAXLEN",
      "~",
      String(Math.max(1000, env.CONTENT_INGEST_QUEUE_CAPACITY)),
      "*",
      "entryId",
      dlqInput.entry.id,
      "reason",
      dlqInput.reason,
      "error",
      dlqInput.error ?? "",
      "payload",
      dlqInput.entry.payload,
      "occurredAt",
      new Date().toISOString(),
    ]);
  };

  return {
    addToDlq,
  };
};
