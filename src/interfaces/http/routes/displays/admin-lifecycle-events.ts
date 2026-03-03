import { randomUUID } from "node:crypto";
import { type DisplayStatus } from "#/application/ports/displays";

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
