import { randomUUID } from "node:crypto";

export type AdminDisplayLifecycleEventType =
  | "display_registered"
  | "display_unregistered";

export interface AdminDisplayLifecycleEvent {
  type: AdminDisplayLifecycleEventType;
  displayId: string;
  displaySlug: string;
  occurredAt: string;
}

type AdminLifecycleSubscriber = (event: AdminDisplayLifecycleEvent) => void;

const lifecycleSubscribers = new Map<string, AdminLifecycleSubscriber>();

export const subscribeToAdminDisplayLifecycleEvents = (
  handler: AdminLifecycleSubscriber,
): (() => void) => {
  const subscriberId = randomUUID();
  lifecycleSubscribers.set(subscriberId, handler);
  return () => {
    lifecycleSubscribers.delete(subscriberId);
  };
};

export const publishAdminDisplayLifecycleEvent = (
  event: AdminDisplayLifecycleEvent,
): void => {
  for (const subscriber of lifecycleSubscribers.values()) {
    subscriber(event);
  }
};
