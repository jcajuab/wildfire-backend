import {
  type ContentIngestionJobStatus,
  type ContentJobEvent,
  type ContentJobEventType,
} from "#/application/ports/content-jobs";
import { env } from "#/env";
import { makeRedisEventBus } from "#/infrastructure/redis/event-bus";
import { isStringField } from "#/shared/event-utils";

const MAX_FIELD_BYTES = 256;

const isContentJobEventType = (value: unknown): value is ContentJobEventType =>
  value === "queued" ||
  value === "processing" ||
  value === "succeeded" ||
  value === "failed";

const isContentIngestionJobStatus = (
  value: unknown,
): value is ContentIngestionJobStatus =>
  value === "QUEUED" ||
  value === "PROCESSING" ||
  value === "SUCCEEDED" ||
  value === "FAILED";

const parseContentJobEvent = (value: unknown): ContentJobEvent | null => {
  if (value == null || typeof value !== "object") return null;

  const event = value as Partial<ContentJobEvent>;
  if (
    !isStringField(event.jobId, MAX_FIELD_BYTES) ||
    !isStringField(event.contentId, MAX_FIELD_BYTES) ||
    !isContentJobEventType(event.type) ||
    !isContentIngestionJobStatus(event.status) ||
    !isStringField(event.timestamp, MAX_FIELD_BYTES) ||
    (event.message != null && !isStringField(event.message, MAX_FIELD_BYTES)) ||
    (event.errorMessage != null &&
      !isStringField(event.errorMessage, MAX_FIELD_BYTES))
  ) {
    return null;
  }

  return event as ContentJobEvent;
};

const bus = makeRedisEventBus<ContentJobEvent>({
  channel: `${env.REDIS_KEY_PREFIX}:events:content-jobs`,
  component: "content",
  eventLabel: "content.job-stream",
  maxMessageBytes: 8_192,
  maxFieldBytes: MAX_FIELD_BYTES,
  maxPreviewBytes: 256,
  invalidLogCooldownMs: 10_000,
  parseEvent: parseContentJobEvent,
  getKey: (event) => event.jobId,
});

export const subscribeToContentJobEvents = (
  jobId: string,
  subscriber: (event: ContentJobEvent) => void,
): (() => void) => bus.subscribeKeyed(jobId, subscriber);

export const publishContentJobEvent = (event: ContentJobEvent): void =>
  bus.publish(event);
