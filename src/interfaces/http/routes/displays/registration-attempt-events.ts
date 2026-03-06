import { randomUUID } from "node:crypto";
import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import {
  executeRedisCommand,
  getRedisPublisherClient,
  getRedisSubscriberClient,
} from "#/infrastructure/redis/client";

export interface RegistrationSucceededEvent {
  type: "registration_succeeded";
  attemptId: string;
  displayId: string;
  slug: string;
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

const MAX_REG_ATTEMPT_FIELD_BYTES = 256;
const MAX_REG_ATTEMPT_MESSAGE_BYTES = 8_192;
const MAX_REG_ATTEMPT_PREVIEW_BYTES = 256;
const INVALID_REDIS_MESSAGE_LOG_COOLDOWN_MS = 10_000;
let lastInvalidEnvelopeLogMs = 0;

const isStringField = (value: unknown, maxBytes: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  Buffer.byteLength(value) <= maxBytes;

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
      event: "registration-attempt.envelope.invalid",
      channel,
      reason,
      messageBytes: Buffer.byteLength(rawMessage),
      messagePreview: rawMessage.slice(0, MAX_REG_ATTEMPT_PREVIEW_BYTES),
    },
    "invalid registration attempt Redis message",
  );
};

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
    slug?: unknown;
    occurredAt?: unknown;
  };

  if (
    candidate.type !== "registration_succeeded" ||
    !isStringField(candidate.attemptId, MAX_REG_ATTEMPT_FIELD_BYTES) ||
    !isStringField(candidate.displayId, MAX_REG_ATTEMPT_FIELD_BYTES) ||
    !isStringField(candidate.slug, MAX_REG_ATTEMPT_FIELD_BYTES) ||
    !isStringField(candidate.occurredAt, MAX_REG_ATTEMPT_FIELD_BYTES)
  ) {
    return null;
  }

  return {
    type: "registration_succeeded",
    attemptId: candidate.attemptId,
    displayId: candidate.displayId,
    slug: candidate.slug,
    occurredAt: candidate.occurredAt,
  };
};

const parseEnvelope = (
  rawMessage: string,
): RegistrationAttemptEnvelope | null => {
  if (Buffer.byteLength(rawMessage) > MAX_REG_ATTEMPT_MESSAGE_BYTES) {
    logInvalidEnvelope(
      "message_too_large",
      redisChannel,
      rawMessage.slice(0, MAX_REG_ATTEMPT_PREVIEW_BYTES),
    );
    return null;
  }

  try {
    const parsed = JSON.parse(rawMessage) as {
      origin?: unknown;
      event?: unknown;
    };

    if (!isStringField(parsed.origin, MAX_REG_ATTEMPT_FIELD_BYTES)) {
      logInvalidEnvelope(
        "invalid_origin",
        redisChannel,
        rawMessage.slice(0, MAX_REG_ATTEMPT_PREVIEW_BYTES),
      );
      return null;
    }

    const event = parseRegistrationAttemptEvent(parsed.event);
    if (!event) {
      logInvalidEnvelope(
        "invalid_event",
        redisChannel,
        rawMessage.slice(0, MAX_REG_ATTEMPT_PREVIEW_BYTES),
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
      rawMessage.slice(0, MAX_REG_ATTEMPT_PREVIEW_BYTES),
    );
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
        addErrorContext(
          {
            component: "displays",
            event: "registration-attempt.subscription.failed",
            channel: redisChannel,
          },
          error,
        ),
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
          event: "registration-attempt.publish.failed",
          channel: redisChannel,
          attemptId: event.attemptId,
        },
        error,
      ),
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
