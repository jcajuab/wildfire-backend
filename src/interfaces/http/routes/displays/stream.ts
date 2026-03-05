import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";
import {
  getRedisPublisherClient,
  getRedisSubscriberClient,
} from "#/infrastructure/redis/client";

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

const toBase64Url = (value: string | Uint8Array): string =>
  Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");

const fromBase64Url = (value: string): Buffer => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const pad =
    normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${pad}`, "base64");
};

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

  if (
    typeof candidate.displayId !== "string" ||
    candidate.displayId.length === 0
  ) {
    return false;
  }

  if (
    typeof candidate.timestamp !== "string" ||
    candidate.timestamp.length === 0
  ) {
    return false;
  }

  if (candidate.reason != null && typeof candidate.reason !== "string") {
    return false;
  }

  return true;
};

const parseEnvelope = (rawMessage: string): DisplayStreamEnvelope | null => {
  try {
    const parsed = JSON.parse(rawMessage) as {
      origin?: unknown;
      event?: unknown;
    };

    if (typeof parsed.origin !== "string" || parsed.origin.length === 0) {
      return null;
    }

    if (!isDisplayStreamEvent(parsed.event)) {
      return null;
    }

    return {
      origin: parsed.origin,
      event: parsed.event,
    };
  } catch {
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
      route: "/display-runtime/:displaySlug/stream",
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
        {
          err: error,
          channel: redisChannel,
        },
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

    await publisher.publish(redisChannel, JSON.stringify(envelope));
  } catch (error) {
    logger.warn(
      {
        err: error,
        channel: redisChannel,
        displayId: event.displayId,
        eventType: event.type,
      },
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
  const [encodedPayload, signature] = input.token.split(".");
  if (!encodedPayload || !signature) return false;

  const expectedSignature = sign(encodedPayload, input.secret);
  if (expectedSignature.length !== signature.length) return false;
  if (
    !timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature))
  ) {
    return false;
  }

  let payload: { d?: string; e?: string };
  try {
    payload = JSON.parse(fromBase64Url(encodedPayload).toString("utf8")) as {
      d?: string;
      e?: string;
    };
  } catch {
    return false;
  }
  if (payload.d !== input.displayId || !payload.e) return false;
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
      route: "/display-runtime/:displaySlug/stream",
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
          route: "/display-runtime/:displaySlug/stream",
          displayId,
          subscriberCount: 0,
        },
        "display stream subscriber disconnected",
      );
      return;
    }
    logger.info(
      {
        route: "/display-runtime/:displaySlug/stream",
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
