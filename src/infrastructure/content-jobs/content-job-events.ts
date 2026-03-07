import { randomUUID } from "node:crypto";
import {
  type ContentIngestionJobStatus,
  type ContentJobEvent,
  type ContentJobEventType,
} from "#/application/ports/content-jobs";
import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import {
  executeRedisCommand,
  getRedisPublisherClient,
  getRedisSubscriberClient,
} from "#/infrastructure/redis/client";

type ContentJobSubscriber = (event: ContentJobEvent) => void;

interface ContentJobEventEnvelope {
  origin: string;
  event: ContentJobEvent;
}

const subscribersByJobId = new Map<string, Map<string, ContentJobSubscriber>>();
const redisChannel = `${env.REDIS_KEY_PREFIX}:events:content-jobs`;
const streamOrigin = randomUUID();

let hasSubscription = false;
let subscriptionPromise: Promise<void> | null = null;

const MAX_CONTENT_JOB_FIELD_BYTES = 256;
const MAX_CONTENT_JOB_MESSAGE_BYTES = 8_192;
const MAX_CONTENT_JOB_PREVIEW_BYTES = 256;
const INVALID_REDIS_MESSAGE_LOG_COOLDOWN_MS = 10_000;
let lastInvalidEnvelopeLogMs = 0;

const isStringField = (value: unknown, maxBytes: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  Buffer.byteLength(value) <= maxBytes;

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

const logInvalidEnvelope = (
  reason: string,
  channel: string,
  rawMessage: string,
): void => {
  const now = Date.now();
  if (now - lastInvalidEnvelopeLogMs < INVALID_REDIS_MESSAGE_LOG_COOLDOWN_MS) {
    return;
  }
  lastInvalidEnvelopeLogMs = now;

  logger.warn(
    {
      component: "content",
      event: "content.job-stream.envelope.invalid",
      channel,
      reason,
      messageBytes: Buffer.byteLength(rawMessage),
      messagePreview: rawMessage.slice(0, MAX_CONTENT_JOB_PREVIEW_BYTES),
    },
    "invalid content job Redis message",
  );
};

const parseEnvelope = (rawMessage: string): ContentJobEventEnvelope | null => {
  if (Buffer.byteLength(rawMessage) > MAX_CONTENT_JOB_MESSAGE_BYTES) {
    logInvalidEnvelope(
      "message_too_large",
      redisChannel,
      rawMessage.slice(0, MAX_CONTENT_JOB_PREVIEW_BYTES),
    );
    return null;
  }

  try {
    const parsed = JSON.parse(rawMessage) as {
      origin?: unknown;
      event?: unknown;
    };
    if (!isStringField(parsed.origin, MAX_CONTENT_JOB_FIELD_BYTES)) {
      logInvalidEnvelope(
        "invalid_origin",
        redisChannel,
        rawMessage.slice(0, MAX_CONTENT_JOB_PREVIEW_BYTES),
      );
      return null;
    }
    if (parsed.event == null || typeof parsed.event !== "object") {
      logInvalidEnvelope(
        "invalid_event",
        redisChannel,
        rawMessage.slice(0, MAX_CONTENT_JOB_PREVIEW_BYTES),
      );
      return null;
    }
    const event = parsed.event as Partial<ContentJobEvent>;
    if (
      !isStringField(event.jobId, MAX_CONTENT_JOB_FIELD_BYTES) ||
      !isStringField(event.contentId, MAX_CONTENT_JOB_FIELD_BYTES) ||
      !isContentJobEventType(event.type) ||
      !isContentIngestionJobStatus(event.status) ||
      !isStringField(event.timestamp, MAX_CONTENT_JOB_FIELD_BYTES) ||
      (event.message != null &&
        !isStringField(event.message, MAX_CONTENT_JOB_FIELD_BYTES)) ||
      (event.errorMessage != null &&
        !isStringField(event.errorMessage, MAX_CONTENT_JOB_FIELD_BYTES))
    ) {
      logInvalidEnvelope(
        "invalid_event_shape",
        redisChannel,
        rawMessage.slice(0, MAX_CONTENT_JOB_PREVIEW_BYTES),
      );
      return null;
    }

    return {
      origin: parsed.origin,
      event: event as ContentJobEvent,
    };
  } catch {
    logInvalidEnvelope(
      "json_parse_failed",
      redisChannel,
      rawMessage.slice(0, MAX_CONTENT_JOB_PREVIEW_BYTES),
    );
    return null;
  }
};

const emitLocally = (event: ContentJobEvent): void => {
  const subscribers = subscribersByJobId.get(event.jobId);
  if (!subscribers) {
    return;
  }
  for (const subscriber of subscribers.values()) {
    subscriber(event);
  }
};

const ensureRedisSubscription = (): void => {
  if (hasSubscription || subscriptionPromise) {
    return;
  }

  subscriptionPromise = (async () => {
    try {
      const subscriber = await getRedisSubscriberClient();
      await subscriber.subscribe(redisChannel, (rawMessage) => {
        const envelope = parseEnvelope(rawMessage);
        if (!envelope || envelope.origin === streamOrigin) {
          return;
        }
        emitLocally(envelope.event);
      });
      hasSubscription = true;
    } catch (error) {
      hasSubscription = false;
      logger.error(
        addErrorContext(
          {
            component: "content",
            event: "content.job-stream.subscription.failed",
            channel: redisChannel,
          },
          error,
        ),
        "content job stream subscription failed",
      );
    } finally {
      subscriptionPromise = null;
    }
  })();
};

const publishToRedis = async (event: ContentJobEvent): Promise<void> => {
  try {
    const publisher = await getRedisPublisherClient();
    const envelope: ContentJobEventEnvelope = {
      origin: streamOrigin,
      event,
    };
    await executeRedisCommand<number>(publisher, [
      "PUBLISH",
      redisChannel,
      JSON.stringify(envelope),
    ]);
  } catch (error) {
    logger.warn(
      addErrorContext(
        {
          component: "content",
          event: "content.job-stream.publish.failed",
          channel: redisChannel,
          jobId: event.jobId,
          contentId: event.contentId,
          status: event.status,
          type: event.type,
        },
        error,
      ),
      "content job stream publish failed",
    );
  }
};

export const subscribeToContentJobEvents = (
  jobId: string,
  subscriber: ContentJobSubscriber,
): (() => void) => {
  ensureRedisSubscription();
  const subscriberId = randomUUID();
  const subscribers = subscribersByJobId.get(jobId) ?? new Map();
  subscribers.set(subscriberId, subscriber);
  subscribersByJobId.set(jobId, subscribers);

  return () => {
    const current = subscribersByJobId.get(jobId);
    if (!current) {
      return;
    }
    current.delete(subscriberId);
    if (current.size === 0) {
      subscribersByJobId.delete(jobId);
    }
  };
};

export const publishContentJobEvent = (event: ContentJobEvent): void => {
  ensureRedisSubscription();
  emitLocally(event);
  void publishToRedis(event);
};
