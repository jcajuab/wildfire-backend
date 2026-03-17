import {
  publishAdminDisplayLifecycleEvent,
  subscribeToAdminDisplayLifecycleEvents,
} from "#/infrastructure/displays/admin-lifecycle-events";
import {
  publishDisplayStreamEvent,
  subscribeToDisplayStream,
} from "#/infrastructure/displays/display-stream";
import {
  publishRegistrationAttemptEvent,
  subscribeToRegistrationAttemptEvents,
} from "#/infrastructure/displays/registration-attempt-events";

export const displayEventPublisher = {
  publish(input: {
    type:
      | "manifest_updated"
      | "schedule_updated"
      | "playlist_updated"
      | "display_refresh_requested";
    displayId: string;
    reason?: string;
    timestamp?: string;
  }) {
    publishDisplayStreamEvent({
      type: input.type,
      displayId: input.displayId,
      reason: input.reason,
      timestamp: input.timestamp ?? new Date().toISOString(),
    });
  },
};

export const displayEventSubscription = {
  subscribe: subscribeToDisplayStream,
};

export const lifecycleEventPublisher = {
  publish: publishAdminDisplayLifecycleEvent,
};

export const lifecycleEventSubscription = {
  subscribe: subscribeToAdminDisplayLifecycleEvents,
};

export const registrationAttemptEventPublisher = {
  publish: publishRegistrationAttemptEvent,
};

export const registrationAttemptEventSubscription = {
  subscribe: subscribeToRegistrationAttemptEvents,
};
