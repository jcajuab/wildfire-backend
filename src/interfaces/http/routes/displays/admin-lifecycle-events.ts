import { randomUUID } from "node:crypto";
import { type DisplayStatus } from "#/application/ports/displays";
import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import {
  executeRedisCommand,
  getRedisPublisherClient,
  getRedisSubscriberClient,
} from "#/infrastructure/redis/client";

export type AdminDisplayLifecycleEventType =
  | "display_registered"
  | "display_unregistered"
  | "display_status_changed";

export type AdminDisplayLifecycleEvent =
  | {
      type: "display_registered";
      displayId: string;
      slug: string;
      occurredAt: string;
    }
  | {
      type: "display_unregistered";
      displayId: string;
      slug: string;
      occurredAt: string;
    }
  | {
      type: "display_status_changed";
      displayId: string;
      slug: string;
      previousStatus: DisplayStatus;
      status: DisplayStatus;
      occurredAt: string;
    };

type AdminLifecycleSubscriber = (event: AdminDisplayLifecycleEvent) => void;

interface AdminLifecycleEnvelope {
  origin: string;
  event: AdminDisplayLifecycleEvent;
}

const lifecycleSubscribers = new Map<string, AdminLifecycleSubscriber>();
const redisChannel = `${env.REDIS_KEY_PREFIX}:events:admin-display-lifecycle`;
const lifecycleOrigin = randomUUID();

let hasLifecycleSubscription = false;
let lifecycleSubscriptionPromise: Promise<void> | null = null;

const MAX_DISPLAY_STATUS_EVENT_BYTES = 256;
const MAX_ADMIN_LIFECYCLE_MESSAGE_BYTES = 8_192;
const MAX_ADMIN_LIFECYCLE_PREVIEW_BYTES = 256;
const INVALID_REDIS_MESSAGE_LOG_COOLDOWN_MS = 10_000;
let lastInvalidEnvelopeLogMs = 0;

const isStringField = (value: unknown, maxBytes: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  Buffer.byteLength(value) <= maxBytes;

const isDisplayStatus = (value: unknown): value is DisplayStatus =>
  value === "PROCESSING" ||
  value === "READY" ||
  value === "LIVE" ||
  value === "DOWN";

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
      component: "displays",
      event: "admin-lifecycle.envelope.invalid",
      channel,
      reason,
      messageBytes: Buffer.byteLength(rawMessage),
      messagePreview: rawMessage.slice(0, MAX_ADMIN_LIFECYCLE_PREVIEW_BYTES),
    },
    "invalid admin lifecycle Redis message",
  );
};

const parseLifecycleEvent = (
  value: unknown,
): AdminDisplayLifecycleEvent | null => {
  if (value == null || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    type?: unknown;
    displayId?: unknown;
    slug?: unknown;
    occurredAt?: unknown;
    previousStatus?: unknown;
    status?: unknown;
  };

  if (
    !isStringField(candidate.displayId, MAX_DISPLAY_STATUS_EVENT_BYTES) ||
    !isStringField(candidate.slug, MAX_DISPLAY_STATUS_EVENT_BYTES) ||
    !isStringField(candidate.occurredAt, MAX_DISPLAY_STATUS_EVENT_BYTES)
  ) {
    return null;
  }

  if (candidate.type === "display_registered") {
    return {
      type: "display_registered",
      displayId: candidate.displayId,
      slug: candidate.slug,
      occurredAt: candidate.occurredAt,
    };
  }

  if (candidate.type === "display_unregistered") {
    return {
      type: "display_unregistered",
      displayId: candidate.displayId,
      slug: candidate.slug,
      occurredAt: candidate.occurredAt,
    };
  }

  if (
    candidate.type === "display_status_changed" &&
    isDisplayStatus(candidate.previousStatus) &&
    isDisplayStatus(candidate.status)
  ) {
    return {
      type: "display_status_changed",
      displayId: candidate.displayId,
      slug: candidate.slug,
      previousStatus: candidate.previousStatus,
      status: candidate.status,
      occurredAt: candidate.occurredAt,
    };
  }

  return null;
};

const parseEnvelope = (rawMessage: string): AdminLifecycleEnvelope | null => {
  if (Buffer.byteLength(rawMessage) > MAX_ADMIN_LIFECYCLE_MESSAGE_BYTES) {
    logInvalidEnvelope(
      "message_too_large",
      redisChannel,
      rawMessage.slice(0, MAX_ADMIN_LIFECYCLE_PREVIEW_BYTES),
    );
    return null;
  }

  try {
    const parsed = JSON.parse(rawMessage) as {
      origin?: unknown;
      event?: unknown;
    };

    if (!isStringField(parsed.origin, MAX_DISPLAY_STATUS_EVENT_BYTES)) {
      logInvalidEnvelope(
        "invalid_origin",
        redisChannel,
        rawMessage.slice(0, MAX_ADMIN_LIFECYCLE_PREVIEW_BYTES),
      );
      return null;
    }

    const event = parseLifecycleEvent(parsed.event);
    if (!event) {
      logInvalidEnvelope(
        "invalid_event",
        redisChannel,
        rawMessage.slice(0, MAX_ADMIN_LIFECYCLE_PREVIEW_BYTES),
      );
      return null;
    }

    return {
      origin: parsed.origin,
      event,
    };
  } catch {
    logInvalidEnvelope(
      "json_parse_failed",
      redisChannel,
      rawMessage.slice(0, MAX_ADMIN_LIFECYCLE_PREVIEW_BYTES),
    );
    return null;
  }
};

const emitLifecycleEventLocally = (event: AdminDisplayLifecycleEvent): void => {
  for (const subscriber of lifecycleSubscribers.values()) {
    subscriber(event);
  }
};

const ensureLifecycleSubscription = (): void => {
  if (hasLifecycleSubscription || lifecycleSubscriptionPromise) {
    return;
  }

  lifecycleSubscriptionPromise = (async () => {
    try {
      const subscriber = await getRedisSubscriberClient();
      await subscriber.subscribe(redisChannel, (rawMessage) => {
        const envelope = parseEnvelope(rawMessage);
        if (!envelope || envelope.origin === lifecycleOrigin) {
          return;
        }

        emitLifecycleEventLocally(envelope.event);
      });
      hasLifecycleSubscription = true;
    } catch (error) {
      hasLifecycleSubscription = false;
      logger.error(
        addErrorContext(
          {
            component: "displays",
            event: "admin-lifecycle.subscription.failed",
            channel: redisChannel,
          },
          error,
        ),
        "admin lifecycle Redis subscription failed",
      );
    } finally {
      lifecycleSubscriptionPromise = null;
    }
  })();
};

const publishLifecycleEventToRedis = async (
  event: AdminDisplayLifecycleEvent,
): Promise<void> => {
  try {
    const publisher = await getRedisPublisherClient();
    const envelope: AdminLifecycleEnvelope = {
      origin: lifecycleOrigin,
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
          component: "displays",
          event: "admin-lifecycle.publish.failed",
          channel: redisChannel,
          eventType: event.type,
          displayId: event.displayId,
        },
        error,
      ),
      "admin lifecycle Redis publish failed",
    );
  }
};

export const subscribeToAdminDisplayLifecycleEvents = (
  handler: AdminLifecycleSubscriber,
): (() => void) => {
  ensureLifecycleSubscription();

  const subscriberId = randomUUID();
  lifecycleSubscribers.set(subscriberId, handler);
  return () => {
    lifecycleSubscribers.delete(subscriberId);
  };
};

export const publishAdminDisplayLifecycleEvent = (
  event: AdminDisplayLifecycleEvent,
): void => {
  ensureLifecycleSubscription();
  emitLifecycleEventLocally(event);
  void publishLifecycleEventToRedis(event);
};
