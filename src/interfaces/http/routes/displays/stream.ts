import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { logger } from "#/infrastructure/observability/logger";

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

const streamSubscribers = new Map<string, Map<string, DisplaySubscriber>>();

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
  const subscribers = streamSubscribers.get(event.displayId);
  if (!subscribers) return;
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
