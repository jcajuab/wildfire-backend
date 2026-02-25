import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { logger } from "#/infrastructure/observability/logger";

export type DeviceStreamEventType =
  | "manifest_updated"
  | "schedule_updated"
  | "playlist_updated"
  | "device_refresh_requested";

export interface DeviceStreamEvent {
  type: DeviceStreamEventType;
  deviceId: string;
  timestamp: string;
  reason?: string;
}

type DeviceSubscriber = (event: DeviceStreamEvent) => void;

const streamSubscribers = new Map<string, Map<string, DeviceSubscriber>>();

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

export const createDeviceStreamToken = (input: {
  deviceId: string;
  secret: string;
  expiresAt: Date;
}): string => {
  const payload = JSON.stringify({
    d: input.deviceId,
    e: input.expiresAt.toISOString(),
  });
  const encodedPayload = toBase64Url(payload);
  const signature = sign(encodedPayload, input.secret);
  return `${encodedPayload}.${signature}`;
};

export const verifyDeviceStreamToken = (input: {
  token: string;
  deviceId: string;
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
  if (payload.d !== input.deviceId || !payload.e) return false;
  const expiresMs = Date.parse(payload.e);
  if (!Number.isFinite(expiresMs)) return false;
  return expiresMs > input.now.getTime();
};

export const subscribeToDeviceStream = (
  deviceId: string,
  handler: DeviceSubscriber,
): (() => void) => {
  const subscriberId = randomUUID();
  const subscribers = streamSubscribers.get(deviceId) ?? new Map();
  subscribers.set(subscriberId, handler);
  streamSubscribers.set(deviceId, subscribers);
  logger.info(
    {
      route: "/displays/:id/stream",
      deviceId,
      subscriberCount: subscribers.size,
    },
    "device stream subscriber connected",
  );

  return () => {
    const current = streamSubscribers.get(deviceId);
    if (!current) return;
    current.delete(subscriberId);
    if (current.size === 0) {
      streamSubscribers.delete(deviceId);
      logger.info(
        {
          route: "/displays/:id/stream",
          deviceId,
          subscriberCount: 0,
        },
        "device stream subscriber disconnected",
      );
      return;
    }
    logger.info(
      {
        route: "/displays/:id/stream",
        deviceId,
        subscriberCount: current.size,
      },
      "device stream subscriber disconnected",
    );
  };
};

export const publishDeviceStreamEvent = (event: DeviceStreamEvent): void => {
  const subscribers = streamSubscribers.get(event.deviceId);
  if (!subscribers) return;
  logger.info(
    {
      route: "/displays/:id/stream",
      deviceId: event.deviceId,
      eventType: event.type,
      subscriberCount: subscribers.size,
      reason: event.reason,
    },
    "device stream event emitted",
  );
  for (const handler of subscribers.values()) {
    handler(event);
  }
};
