import { randomUUID } from "node:crypto";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import {
  executeRedisCommand,
  getRedisPublisherClient,
  getRedisSubscriberClient,
} from "#/infrastructure/redis/client";
import { isStringField, makeLogInvalidEnvelope } from "#/shared/event-utils";

type Subscriber<TEvent> = (event: TEvent) => void;

interface Envelope<TEvent> {
  origin: string;
  event: TEvent;
}

/**
 * Creates a Redis pub/sub event bus for a single channel.
 *
 * Routing modes:
 *   - broadcast: all subscribers receive every event (pass getKey: null)
 *   - per-key:   each subscriber is keyed by a field on the event (pass getKey: e => e.someId)
 *
 * The returned bus is a module-level singleton: call makeRedisEventBus once at module scope.
 */
export function makeRedisEventBus<TEvent>(config: {
  channel: string;
  component: string;
  eventLabel: string;
  maxMessageBytes: number;
  maxFieldBytes: number;
  maxPreviewBytes: number;
  invalidLogCooldownMs: number;
  parseEvent: (value: unknown) => TEvent | null;
  getKey: ((event: TEvent) => string) | null;
}) {
  const origin = randomUUID();
  const broadcastSubscribers = new Map<string, Subscriber<TEvent>>();
  const keyedSubscribers = new Map<string, Map<string, Subscriber<TEvent>>>();

  let hasSubscription = false;
  let subscriptionPromise: Promise<void> | null = null;

  const logInvalidEnvelope = makeLogInvalidEnvelope({
    component: config.component,
    event: `${config.eventLabel}.envelope.invalid`,
    previewBytes: config.maxPreviewBytes,
    message: `invalid ${config.eventLabel} Redis message`,
    cooldownMs: config.invalidLogCooldownMs,
  });

  const parseEnvelope = (rawMessage: string): Envelope<TEvent> | null => {
    if (Buffer.byteLength(rawMessage) > config.maxMessageBytes) {
      logInvalidEnvelope(
        "message_too_large",
        config.channel,
        rawMessage.slice(0, config.maxPreviewBytes),
      );
      return null;
    }

    try {
      const parsed = JSON.parse(rawMessage) as {
        origin?: unknown;
        event?: unknown;
      };

      if (!isStringField(parsed.origin, config.maxFieldBytes)) {
        logInvalidEnvelope(
          "invalid_origin",
          config.channel,
          rawMessage.slice(0, config.maxPreviewBytes),
        );
        return null;
      }

      const event = config.parseEvent(parsed.event);
      if (!event) {
        logInvalidEnvelope(
          "invalid_event",
          config.channel,
          rawMessage.slice(0, config.maxPreviewBytes),
        );
        return null;
      }

      return { origin: parsed.origin, event };
    } catch {
      logInvalidEnvelope(
        "json_parse_failed",
        config.channel,
        rawMessage.slice(0, config.maxPreviewBytes),
      );
      return null;
    }
  };

  const emitLocally = (event: TEvent): void => {
    if (config.getKey === null) {
      for (const subscriber of broadcastSubscribers.values()) {
        subscriber(event);
      }
    } else {
      const key = config.getKey(event);
      const subscribers = keyedSubscribers.get(key);
      if (!subscribers) return;
      for (const subscriber of subscribers.values()) {
        subscriber(event);
      }
    }
  };

  const ensureSubscription = (): void => {
    if (hasSubscription || subscriptionPromise) return;

    subscriptionPromise = (async () => {
      try {
        const subscriber = await getRedisSubscriberClient();
        await subscriber.subscribe(config.channel, (rawMessage) => {
          const envelope = parseEnvelope(rawMessage);
          if (!envelope || envelope.origin === origin) return;
          emitLocally(envelope.event);
        });
        hasSubscription = true;
      } catch (error) {
        hasSubscription = false;
        logger.error(
          addErrorContext(
            {
              component: config.component,
              event: `${config.eventLabel}.subscription.failed`,
              channel: config.channel,
            },
            error,
          ),
          `${config.eventLabel} Redis subscription failed`,
        );
      } finally {
        subscriptionPromise = null;
      }
    })();
  };

  const publishToRedis = async (event: TEvent): Promise<void> => {
    try {
      const publisher = await getRedisPublisherClient();
      const envelope: Envelope<TEvent> = { origin, event };
      await executeRedisCommand<number>(publisher, [
        "PUBLISH",
        config.channel,
        JSON.stringify(envelope),
      ]);
    } catch (error) {
      logger.warn(
        addErrorContext(
          {
            component: config.component,
            event: `${config.eventLabel}.publish.failed`,
            channel: config.channel,
          },
          error,
        ),
        `${config.eventLabel} Redis publish failed`,
      );
    }
  };

  /** Subscribe to all events (broadcast mode). Returns an unsubscribe function. */
  const subscribeBroadcast = (handler: Subscriber<TEvent>): (() => void) => {
    ensureSubscription();
    const subscriberId = randomUUID();
    broadcastSubscribers.set(subscriberId, handler);
    return () => {
      broadcastSubscribers.delete(subscriberId);
    };
  };

  /** Subscribe to events for a specific key (per-key mode). Returns an unsubscribe function. */
  const subscribeKeyed = (
    key: string,
    handler: Subscriber<TEvent>,
  ): (() => void) => {
    ensureSubscription();
    const subscriberId = randomUUID();
    const subscribers = keyedSubscribers.get(key) ?? new Map();
    subscribers.set(subscriberId, handler);
    keyedSubscribers.set(key, subscribers);
    return () => {
      const current = keyedSubscribers.get(key);
      if (!current) return;
      current.delete(subscriberId);
      if (current.size === 0) keyedSubscribers.delete(key);
    };
  };

  const publish = (event: TEvent): void => {
    ensureSubscription();
    emitLocally(event);
    void publishToRedis(event);
  };

  return { subscribeBroadcast, subscribeKeyed, publish };
}
