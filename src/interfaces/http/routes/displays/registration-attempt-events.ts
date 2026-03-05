import { randomUUID } from "node:crypto";
import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";
import {
  getRedisPublisherClient,
  getRedisSubscriberClient,
} from "#/infrastructure/redis/client";

export interface RegistrationSucceededEvent {
  type: "registration_succeeded";
  attemptId: string;
  displayId: string;
  displaySlug: string;
  occurredAt: string;
}

type RegistrationAttemptEvent = RegistrationSucceededEvent;
type RegistrationAttemptSubscriber = (event: RegistrationAttemptEvent) => void;

interface RegistrationAttemptEnvelope {
  origin: string;
  event: RegistrationAttemptEvent;
}

const subscribersByAttemptId = new Map<
  string,
  Map<string, RegistrationAttemptSubscriber>
>();

const redisChannel = `${env.REDIS_KEY_PREFIX}:events:registration-attempt`;
const registrationAttemptOrigin = randomUUID();

let hasRegistrationAttemptSubscription = false;
let registrationAttemptSubscriptionPromise: Promise<void> | null = null;

const isStringField = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const parseRegistrationAttemptEvent = (
  value: unknown,
): RegistrationAttemptEvent | null => {
  if (value == null || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    type?: unknown;
    attemptId?: unknown;
    displayId?: unknown;
    displaySlug?: unknown;
    occurredAt?: unknown;
  };

  if (
    candidate.type !== "registration_succeeded" ||
    !isStringField(candidate.attemptId) ||
    !isStringField(candidate.displayId) ||
    !isStringField(candidate.displaySlug) ||
    !isStringField(candidate.occurredAt)
  ) {
    return null;
  }

  return {
    type: "registration_succeeded",
    attemptId: candidate.attemptId,
    displayId: candidate.displayId,
    displaySlug: candidate.displaySlug,
    occurredAt: candidate.occurredAt,
  };
};

const parseEnvelope = (
  rawMessage: string,
): RegistrationAttemptEnvelope | null => {
  try {
    const parsed = JSON.parse(rawMessage) as {
      origin?: unknown;
      event?: unknown;
    };

    if (!isStringField(parsed.origin)) {
      return null;
    }

    const event = parseRegistrationAttemptEvent(parsed.event);
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

const emitRegistrationAttemptEventLocally = (
  event: RegistrationAttemptEvent,
): void => {
  const subscribers = subscribersByAttemptId.get(event.attemptId);
  if (!subscribers) {
    return;
  }

  for (const subscriber of subscribers.values()) {
    subscriber(event);
  }
};

const ensureRegistrationAttemptSubscription = (): void => {
  if (
    hasRegistrationAttemptSubscription ||
    registrationAttemptSubscriptionPromise
  ) {
    return;
  }

  registrationAttemptSubscriptionPromise = (async () => {
    try {
      const subscriber = await getRedisSubscriberClient();
      await subscriber.subscribe(redisChannel, (rawMessage) => {
        const envelope = parseEnvelope(rawMessage);
        if (!envelope || envelope.origin === registrationAttemptOrigin) {
          return;
        }

        emitRegistrationAttemptEventLocally(envelope.event);
      });
      hasRegistrationAttemptSubscription = true;
    } catch (error) {
      hasRegistrationAttemptSubscription = false;
      logger.error(
        {
          err: error,
          channel: redisChannel,
        },
        "registration-attempt Redis subscription failed",
      );
    } finally {
      registrationAttemptSubscriptionPromise = null;
    }
  })();
};

const publishRegistrationAttemptEventToRedis = async (
  event: RegistrationAttemptEvent,
): Promise<void> => {
  try {
    const publisher = await getRedisPublisherClient();
    const envelope: RegistrationAttemptEnvelope = {
      origin: registrationAttemptOrigin,
      event,
    };

    await publisher.publish(redisChannel, JSON.stringify(envelope));
  } catch (error) {
    logger.warn(
      {
        err: error,
        channel: redisChannel,
        attemptId: event.attemptId,
      },
      "registration-attempt Redis publish failed",
    );
  }
};

export const subscribeToRegistrationAttemptEvents = (
  attemptId: string,
  handler: RegistrationAttemptSubscriber,
): (() => void) => {
  ensureRegistrationAttemptSubscription();

  const subscriberId = randomUUID();
  const subscribers = subscribersByAttemptId.get(attemptId) ?? new Map();
  subscribers.set(subscriberId, handler);
  subscribersByAttemptId.set(attemptId, subscribers);

  return () => {
    const current = subscribersByAttemptId.get(attemptId);
    if (!current) {
      return;
    }

    current.delete(subscriberId);
    if (current.size === 0) {
      subscribersByAttemptId.delete(attemptId);
    }
  };
};

export const publishRegistrationAttemptEvent = (
  event: RegistrationAttemptEvent,
): void => {
  ensureRegistrationAttemptSubscription();
  emitRegistrationAttemptEventLocally(event);
  void publishRegistrationAttemptEventToRedis(event);
};
