import { randomUUID } from "node:crypto";
import { type DisplayStatus } from "#/application/ports/displays";
import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";
import {
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
      displaySlug: string;
      occurredAt: string;
    }
  | {
      type: "display_unregistered";
      displayId: string;
      displaySlug: string;
      occurredAt: string;
    }
  | {
      type: "display_status_changed";
      displayId: string;
      displaySlug: string;
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

const isStringField = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const parseLifecycleEvent = (
  value: unknown,
): AdminDisplayLifecycleEvent | null => {
  if (value == null || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    type?: unknown;
    displayId?: unknown;
    displaySlug?: unknown;
    occurredAt?: unknown;
    previousStatus?: unknown;
    status?: unknown;
  };

  if (
    !isStringField(candidate.displayId) ||
    !isStringField(candidate.displaySlug) ||
    !isStringField(candidate.occurredAt)
  ) {
    return null;
  }

  if (candidate.type === "display_registered") {
    return {
      type: "display_registered",
      displayId: candidate.displayId,
      displaySlug: candidate.displaySlug,
      occurredAt: candidate.occurredAt,
    };
  }

  if (candidate.type === "display_unregistered") {
    return {
      type: "display_unregistered",
      displayId: candidate.displayId,
      displaySlug: candidate.displaySlug,
      occurredAt: candidate.occurredAt,
    };
  }

  if (
    candidate.type === "display_status_changed" &&
    isStringField(candidate.previousStatus) &&
    isStringField(candidate.status)
  ) {
    return {
      type: "display_status_changed",
      displayId: candidate.displayId,
      displaySlug: candidate.displaySlug,
      previousStatus: candidate.previousStatus as DisplayStatus,
      status: candidate.status as DisplayStatus,
      occurredAt: candidate.occurredAt,
    };
  }

  return null;
};

const parseEnvelope = (rawMessage: string): AdminLifecycleEnvelope | null => {
  try {
    const parsed = JSON.parse(rawMessage) as {
      origin?: unknown;
      event?: unknown;
    };

    if (!isStringField(parsed.origin)) {
      return null;
    }

    const event = parseLifecycleEvent(parsed.event);
    if (!event) {
      return null;
    }

    return {
      origin: parsed.origin,
      event,
    };
  } catch {
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
        {
          err: error,
          channel: redisChannel,
        },
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

    await publisher.publish(redisChannel, JSON.stringify(envelope));
  } catch (error) {
    logger.warn(
      {
        err: error,
        channel: redisChannel,
        eventType: event.type,
        displayId: event.displayId,
      },
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
