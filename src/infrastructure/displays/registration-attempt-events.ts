import { env } from "#/env";
import { makeRedisEventBus } from "#/infrastructure/redis/event-bus";
import { isStringField } from "#/shared/event-utils";

export interface RegistrationSucceededEvent {
  type: "registration_succeeded";
  attemptId: string;
  displayId: string;
  slug: string;
  occurredAt: string;
}

type RegistrationAttemptEvent = RegistrationSucceededEvent;

const MAX_FIELD_BYTES = 256;

const parseRegistrationAttemptEvent = (
  value: unknown,
): RegistrationAttemptEvent | null => {
  if (value == null || typeof value !== "object") return null;

  const candidate = value as {
    type?: unknown;
    attemptId?: unknown;
    displayId?: unknown;
    slug?: unknown;
    occurredAt?: unknown;
  };

  if (
    candidate.type !== "registration_succeeded" ||
    !isStringField(candidate.attemptId, MAX_FIELD_BYTES) ||
    !isStringField(candidate.displayId, MAX_FIELD_BYTES) ||
    !isStringField(candidate.slug, MAX_FIELD_BYTES) ||
    !isStringField(candidate.occurredAt, MAX_FIELD_BYTES)
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

const bus = makeRedisEventBus<RegistrationAttemptEvent>({
  channel: `${env.REDIS_KEY_PREFIX}:events:registration-attempt`,
  component: "displays",
  eventLabel: "registration-attempt",
  maxMessageBytes: 8_192,
  maxFieldBytes: MAX_FIELD_BYTES,
  maxPreviewBytes: 256,
  invalidLogCooldownMs: 10_000,
  parseEvent: parseRegistrationAttemptEvent,
  getKey: (event) => event.attemptId,
});

export const subscribeToRegistrationAttemptEvents = (
  attemptId: string,
  handler: (event: RegistrationAttemptEvent) => void,
): (() => void) => bus.subscribeKeyed(attemptId, handler);

export const publishRegistrationAttemptEvent = (
  event: RegistrationAttemptEvent,
): void => bus.publish(event);
