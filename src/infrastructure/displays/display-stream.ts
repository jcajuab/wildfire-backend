import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  fromBase64Url,
  toBase64Url,
} from "#/application/use-cases/displays/display-crypto";
import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import {
  executeRedisCommand,
  getRedisPublisherClient,
  getRedisSubscriberClient,
} from "#/infrastructure/redis/client";
import { isStringField, makeLogInvalidEnvelope } from "#/shared/event-utils";

export type DisplayStreamEventType =
  | "manifest_updated"
  | "schedule_updated"
  | "playlist_updated"
  | "display_refresh_requested";

export interface DisplayStreamEvent {
  type: DisplayStreamEventType;
  displayId: string;
  timestamp: string;
  reason?: string;
}

type DisplaySubscriber = (event: DisplayStreamEvent) => void;

interface DisplayStreamEnvelope {
  origin: string;
  event: DisplayStreamEvent;
}

const streamSubscribers = new Map<string, Map<string, DisplaySubscriber>>();
const redisChannel = `${env.REDIS_KEY_PREFIX}:events:display-stream`;
const streamOrigin = randomUUID();

let hasStreamSubscription = false;
let streamSubscriptionPromise: Promise<void> | null = null;

const MAX_DISPLAY_STREAM_MESSAGE_BYTES = 8_192;
const MAX_DISPLAY_STREAM_PREVIEW_BYTES = 256;
const MAX_DISPLAY_STREAM_TOKEN_SEGMENTS = 2;
const MAX_DISPLAY_STREAM_TOKEN_SEGMENT_BYTES = 2_048;
const MAX_DISPLAY_ID_BYTES = 128;
const MAX_TIMESTAMP_BYTES = 64;
const INVALID_REDIS_MESSAGE_LOG_COOLDOWN_MS = 10_000;

const logInvalidEnvelope = makeLogInvalidEnvelope({
  component: "displays",
  event: "display-stream.envelope.invalid",
  previewBytes: MAX_DISPLAY_STREAM_PREVIEW_BYTES,
  message: "invalid display stream Redis message",
  cooldownMs: INVALID_REDIS_MESSAGE_LOG_COOLDOWN_MS,
});

const sign = (payload: string, secret: string): string =>
  toBase64Url(createHmac("sha256", secret).update(payload).digest());

const isDisplayStreamEventType = (
  value: unknown,
): value is DisplayStreamEventType =>
  value === "manifest_updated" ||
  value === "schedule_updated" ||
  value === "playlist_updated" ||
  value === "display_refresh_requested";

const isDisplayStreamEvent = (value: unknown): value is DisplayStreamEvent => {
  if (value == null || typeof value !== "object") {
    return false;
  }

  const candidate = value as {
    type?: unknown;
    displayId?: unknown;
    timestamp?: unknown;
    reason?: unknown;
  };

  if (!isDisplayStreamEventType(candidate.type)) {
    return false;
  }

  if (!isStringField(candidate.displayId, MAX_DISPLAY_ID_BYTES)) {
    return false;
  }

  if (!isStringField(candidate.timestamp, MAX_TIMESTAMP_BYTES)) {
    return false;
  }

  if (
    candidate.reason != null &&
    !isStringField(candidate.reason, MAX_DISPLAY_ID_BYTES)
  ) {
    return false;
  }

  return true;
};

const parseEnvelope = (rawMessage: string): DisplayStreamEnvelope | null => {
  if (Buffer.byteLength(rawMessage) > MAX_DISPLAY_STREAM_MESSAGE_BYTES) {
    logInvalidEnvelope(
      "message_too_large",
      redisChannel,
      rawMessage.slice(0, MAX_DISPLAY_STREAM_PREVIEW_BYTES),
    );
    return null;
  }

  try {
    const parsed = JSON.parse(rawMessage) as {
      origin?: unknown;
      event?: unknown;
    };

    if (!isStringField(parsed.origin, MAX_DISPLAY_ID_BYTES)) {
      logInvalidEnvelope(
        "invalid_origin",
        redisChannel,
        rawMessage.slice(0, MAX_DISPLAY_STREAM_PREVIEW_BYTES),
      );
      return null;
    }

    if (!isDisplayStreamEvent(parsed.event)) {
      logInvalidEnvelope(
        "invalid_event",
        redisChannel,
        rawMessage.slice(0, MAX_DISPLAY_STREAM_PREVIEW_BYTES),
      );
      return null;
    }

    return {
      origin: parsed.origin,
      event: parsed.event,
    };
  } catch {
    logInvalidEnvelope(
      "json_parse_failed",
      redisChannel,
      rawMessage.slice(0, MAX_DISPLAY_STREAM_PREVIEW_BYTES),
    );
    return null;
  }
};

const emitDisplayStreamEventLocally = (event: DisplayStreamEvent): void => {
  const subscribers = streamSubscribers.get(event.displayId);
  if (!subscribers) {
    return;
  }

  logger.info(
    {
      component: "displays",
      event: "display-stream.event_emitted",
      route: "/display-runtime/:slug/stream",
      displayId: event.displayId,
      eventType: event.type,
      subscriberCount: subscribers.size,
      reason: event.reason,
    },
    "display stream event emitted",
  );

  for (const handler of subscribers.values()) {
    handler(event);
  }
};

const ensureStreamRedisSubscription = (): void => {
  if (hasStreamSubscription || streamSubscriptionPromise) {
    return;
  }

  streamSubscriptionPromise = (async () => {
    try {
      const subscriber = await getRedisSubscriberClient();
      await subscriber.subscribe(redisChannel, (rawMessage) => {
        const envelope = parseEnvelope(rawMessage);
        if (!envelope || envelope.origin === streamOrigin) {
          return;
        }

        emitDisplayStreamEventLocally(envelope.event);
      });
      hasStreamSubscription = true;
    } catch (error) {
      hasStreamSubscription = false;
      logger.error(
        addErrorContext(
          {
            component: "displays",
            event: "display-stream.subscription.failed",
            channel: redisChannel,
          },
          error,
        ),
        "display stream Redis subscription failed",
      );
    } finally {
      streamSubscriptionPromise = null;
    }
  })();
};

const publishDisplayStreamEventToRedis = async (
  event: DisplayStreamEvent,
): Promise<void> => {
  try {
    const publisher = await getRedisPublisherClient();
    const envelope: DisplayStreamEnvelope = {
      origin: streamOrigin,
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
          event: "display-stream.publish.failed",
          channel: redisChannel,
          displayId: event.displayId,
          eventType: event.type,
        },
        error,
      ),
      "display stream Redis publish failed",
    );
  }
};

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

export const subscribeToDisplayStream = (
  displayId: string,
  handler: DisplaySubscriber,
): (() => void) => {
  ensureStreamRedisSubscription();

  const subscriberId = randomUUID();
  const subscribers = streamSubscribers.get(displayId) ?? new Map();
  subscribers.set(subscriberId, handler);
  streamSubscribers.set(displayId, subscribers);
  logger.info(
    {
      component: "displays",
      event: "display-stream.subscriber.connected",
      route: "/display-runtime/:slug/stream",
      displayId,
      subscriberCount: subscribers.size,
    },
    "display stream subscriber connected",
  );

  return () => {
    const current = streamSubscribers.get(displayId);
    if (!current) return;
    current.delete(subscriberId);
    if (current.size === 0) {
      streamSubscribers.delete(displayId);
      logger.info(
        {
          component: "displays",
          event: "display-stream.subscriber.disconnected",
          route: "/display-runtime/:slug/stream",
          displayId,
          subscriberCount: 0,
        },
        "display stream subscriber disconnected",
      );
      return;
    }
    logger.info(
      {
        component: "displays",
        event: "display-stream.subscriber.disconnected",
        route: "/display-runtime/:slug/stream",
        displayId,
        subscriberCount: current.size,
      },
      "display stream subscriber disconnected",
    );
  };
};

export const publishDisplayStreamEvent = (event: DisplayStreamEvent): void => {
  ensureStreamRedisSubscription();
  emitDisplayStreamEventLocally(event);
  void publishDisplayStreamEventToRedis(event);
};
