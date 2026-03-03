import { randomUUID } from "node:crypto";

export interface RegistrationSucceededEvent {
  type: "registration_succeeded";
  attemptId: string;
  displayId: string;
  displaySlug: string;
  occurredAt: string;
}

type RegistrationAttemptEvent = RegistrationSucceededEvent;
type RegistrationAttemptSubscriber = (event: RegistrationAttemptEvent) => void;

const subscribersByAttemptId = new Map<
  string,
  Map<string, RegistrationAttemptSubscriber>
>();

export const subscribeToRegistrationAttemptEvents = (
  attemptId: string,
  handler: RegistrationAttemptSubscriber,
): (() => void) => {
  const subscriberId = randomUUID();
  const subscribers = subscribersByAttemptId.get(attemptId) ?? new Map();
  subscribers.set(subscriberId, handler);
  subscribersByAttemptId.set(attemptId, subscribers);

  return () => {
    const current = subscribersByAttemptId.get(attemptId);
    if (!current) return;
    current.delete(subscriberId);
    if (current.size === 0) {
      subscribersByAttemptId.delete(attemptId);
    }
  };
};

export const publishRegistrationAttemptEvent = (
  event: RegistrationAttemptEvent,
): void => {
  const subscribers = subscribersByAttemptId.get(event.attemptId);
  if (!subscribers) return;
  for (const subscriber of subscribers.values()) {
    subscriber(event);
  }
};
