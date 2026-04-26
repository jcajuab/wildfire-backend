import { createHmac, timingSafeEqual } from "node:crypto";
import {
  fromBase64Url,
  toBase64Url,
} from "#/application/use-cases/displays/display-crypto";
import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";
import { makeRedisEventBus } from "#/infrastructure/redis/event-bus";
import { isStringField } from "#/shared/event-utils";

export type DisplayStreamEventType =
  | "manifest_updated"
  | "schedule_updated"
  | "playlist_updated"
  | "display_refresh_requested"
  | "display_unregistered";

export interface DisplayStreamEvent {
  type: DisplayStreamEventType;
  displayId: string;
  timestamp: string;
  reason?: string;
}

const MAX_DISPLAY_STREAM_MESSAGE_BYTES = 8_192;
const MAX_DISPLAY_STREAM_PREVIEW_BYTES = 256;
const MAX_DISPLAY_STREAM_TOKEN_SEGMENTS = 2;
const MAX_DISPLAY_STREAM_TOKEN_SEGMENT_BYTES = 2_048;
const MAX_DISPLAY_ID_BYTES = 128;
const MAX_TIMESTAMP_BYTES = 64;
const INVALID_REDIS_MESSAGE_LOG_COOLDOWN_MS = 10_000;
const MAX_FIELD_BYTES = 256;

const isDisplayStreamEventType = (
  value: unknown,
): value is DisplayStreamEventType =>
  value === "manifest_updated" ||
  value === "schedule_updated" ||
  value === "playlist_updated" ||
  value === "display_refresh_requested" ||
  value === "display_unregistered";

const parseDisplayStreamEvent = (value: unknown): DisplayStreamEvent | null => {
  if (value == null || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    type?: unknown;
    displayId?: unknown;
    timestamp?: unknown;
    reason?: unknown;
  };

  if (!isDisplayStreamEventType(candidate.type)) {
    return null;
  }

  if (!isStringField(candidate.displayId, MAX_DISPLAY_ID_BYTES)) {
    return null;
  }

  if (!isStringField(candidate.timestamp, MAX_TIMESTAMP_BYTES)) {
    return null;
  }

  if (
    candidate.reason != null &&
    !isStringField(candidate.reason, MAX_FIELD_BYTES)
  ) {
    return null;
  }

  return candidate as DisplayStreamEvent;
};

const bus = makeRedisEventBus<DisplayStreamEvent>({
  channel: `${env.REDIS_KEY_PREFIX}:events:display-stream`,
  component: "displays",
  eventLabel: "display-stream",
  maxMessageBytes: MAX_DISPLAY_STREAM_MESSAGE_BYTES,
  maxFieldBytes: MAX_FIELD_BYTES,
  maxPreviewBytes: MAX_DISPLAY_STREAM_PREVIEW_BYTES,
  invalidLogCooldownMs: INVALID_REDIS_MESSAGE_LOG_COOLDOWN_MS,
  parseEvent: parseDisplayStreamEvent,
  getKey: (event) => event.displayId,
});

export const subscribeToDisplayStream = (
  displayId: string,
  handler: (event: DisplayStreamEvent) => void,
): (() => void) => {
  const unsubscribe = bus.subscribeKeyed(displayId, (event) => {
    logger.debug(
      {
        component: "displays",
        event: "display-stream.event_emitted",
        route: "/display-runtime/:slug/stream",
        displayId: event.displayId,
        eventType: event.type,
        reason: event.reason,
      },
      "display stream event emitted",
    );
    handler(event);
  });

  logger.info(
    {
      component: "displays",
      event: "display-stream.subscriber.connected",
      route: "/display-runtime/:slug/stream",
      displayId,
    },
    "display stream subscriber connected",
  );

  return () => {
    unsubscribe();
    logger.info(
      {
        component: "displays",
        event: "display-stream.subscriber.disconnected",
        route: "/display-runtime/:slug/stream",
        displayId,
      },
      "display stream subscriber disconnected",
    );
  };
};

export const publishDisplayStreamEvent = (event: DisplayStreamEvent): void =>
  bus.publish(event);

// --- Token utilities (unchanged) ---

const sign = (payload: string, secret: string): string =>
  toBase64Url(createHmac("sha256", secret).update(payload).digest());

export const createDisplayStreamToken = (input: {
  displayId: string;
  secret: string;
  expiresAt: Date;
}): string => {
  const payload = JSON.stringify({
    d: input.displayId,
    e: input.expiresAt.toISOString(),
  });
  const encodedPayload = toBase64Url(payload);
  const signature = sign(encodedPayload, input.secret);
  return `${encodedPayload}.${signature}`;
};

export const verifyDisplayStreamToken = (input: {
  token: string;
  displayId: string;
  secret: string;
  now: Date;
}): boolean => {
  const tokenParts = input.token.split(".");
  if (
    tokenParts.length !== MAX_DISPLAY_STREAM_TOKEN_SEGMENTS ||
    tokenParts[0] == null ||
    tokenParts[1] == null
  ) {
    return false;
  }

  const [encodedPayload, signature] = tokenParts;
  if (
    encodedPayload.length === 0 ||
    signature.length === 0 ||
    encodedPayload.length > MAX_DISPLAY_STREAM_TOKEN_SEGMENT_BYTES ||
    signature.length > MAX_DISPLAY_STREAM_TOKEN_SEGMENT_BYTES ||
    !isStringField(input.displayId, MAX_DISPLAY_ID_BYTES)
  ) {
    return false;
  }

  const expectedSignature = sign(encodedPayload, input.secret);
  if (
    expectedSignature.length !== signature.length ||
    !timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature))
  ) {
    return false;
  }

  let payload: { d?: string; e?: string };
  try {
    const payloadBytes = fromBase64Url(encodedPayload);
    if (payloadBytes.length > MAX_DISPLAY_STREAM_MESSAGE_BYTES) {
      return false;
    }

    payload = JSON.parse(payloadBytes.toString("utf8")) as {
      d?: string;
      e?: string;
    };
  } catch {
    return false;
  }

  if (
    !isStringField(payload.d, MAX_DISPLAY_ID_BYTES) ||
    payload.d !== input.displayId ||
    !isStringField(payload.e, MAX_TIMESTAMP_BYTES)
  ) {
    return false;
  }

  const expiresMs = Date.parse(payload.e);
  if (!Number.isFinite(expiresMs)) return false;
  return expiresMs > input.now.getTime();
};
