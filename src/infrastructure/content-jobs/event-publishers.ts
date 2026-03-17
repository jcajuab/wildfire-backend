import {
  publishContentJobEvent,
  subscribeToContentJobEvents,
} from "#/infrastructure/content-jobs/content-job-events";

export const contentJobEventPublisher = {
  publish: publishContentJobEvent,
};

export const contentJobEventSubscription = {
  subscribe: subscribeToContentJobEvents,
};
