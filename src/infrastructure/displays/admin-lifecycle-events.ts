import { type DisplayStatus } from "#/application/ports/displays";
import { env } from "#/env";
import { makeRedisEventBus } from "#/infrastructure/redis/event-bus";
import { isStringField } from "#/shared/event-utils";

export type AdminDisplayLifecycleEventType =
  | "display_registered"
  | "display_unregistered"
  | "display_status_changed"
  | "playlist_status_changed"
  | "content_status_changed";

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
    }
  | {
      type: "playlist_status_changed";
      playlistId: string;
      status: "DRAFT" | "IN_USE";
      occurredAt: string;
    }
  | {
      type: "content_status_changed";
      contentId: string;
      status: "PROCESSING" | "READY" | "FAILED";
      occurredAt: string;
    };

const MAX_FIELD_BYTES = 256;

const isDisplayStatus = (value: unknown): value is DisplayStatus =>
  value === "PROCESSING" ||
  value === "READY" ||
  value === "LIVE" ||
  value === "DOWN";

const isPlaylistStatus = (value: unknown): value is "DRAFT" | "IN_USE" =>
  value === "DRAFT" || value === "IN_USE";

const isContentStatus = (
  value: unknown,
): value is "PROCESSING" | "READY" | "FAILED" =>
  value === "PROCESSING" || value === "READY" || value === "FAILED";

const parseLifecycleEvent = (
  value: unknown,
): AdminDisplayLifecycleEvent | null => {
  if (value == null || typeof value !== "object") return null;

  const candidate = value as {
    type?: unknown;
    displayId?: unknown;
    slug?: unknown;
    occurredAt?: unknown;
    previousStatus?: unknown;
    status?: unknown;
    playlistId?: unknown;
    contentId?: unknown;
  };

  if (
    candidate.type === "content_status_changed" &&
    isStringField(candidate.contentId, MAX_FIELD_BYTES) &&
    isContentStatus(candidate.status) &&
    isStringField(candidate.occurredAt, MAX_FIELD_BYTES)
  ) {
    return {
      type: "content_status_changed",
      contentId: candidate.contentId,
      status: candidate.status,
      occurredAt: candidate.occurredAt,
    };
  }

  if (
    candidate.type === "playlist_status_changed" &&
    isStringField(candidate.playlistId, MAX_FIELD_BYTES) &&
    isPlaylistStatus(candidate.status) &&
    isStringField(candidate.occurredAt, MAX_FIELD_BYTES)
  ) {
    return {
      type: "playlist_status_changed",
      playlistId: candidate.playlistId,
      status: candidate.status,
      occurredAt: candidate.occurredAt,
    };
  }

  if (
    !isStringField(candidate.displayId, MAX_FIELD_BYTES) ||
    !isStringField(candidate.slug, MAX_FIELD_BYTES) ||
    !isStringField(candidate.occurredAt, MAX_FIELD_BYTES)
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

const bus = makeRedisEventBus<AdminDisplayLifecycleEvent>({
  channel: `${env.REDIS_KEY_PREFIX}:events:admin-display-lifecycle`,
  component: "displays",
  eventLabel: "admin-lifecycle",
  maxMessageBytes: 8_192,
  maxFieldBytes: MAX_FIELD_BYTES,
  maxPreviewBytes: 256,
  invalidLogCooldownMs: 10_000,
  parseEvent: parseLifecycleEvent,
  getKey: null,
});

export const subscribeToAdminDisplayLifecycleEvents = (
  handler: (event: AdminDisplayLifecycleEvent) => void,
): (() => void) => bus.subscribeBroadcast(handler);

export const publishAdminDisplayLifecycleEvent = (
  event: AdminDisplayLifecycleEvent,
): void => bus.publish(event);
