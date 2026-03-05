import { createClient } from "redis";
import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";

type RedisConnectionKind = "command" | "publisher" | "subscriber";
type RedisClient = ReturnType<typeof createClient>;

const reconnectStrategy =
  (kind: RedisConnectionKind) =>
  (retries: number): number | Error => {
    if (retries >= env.REDIS_RETRY_MAX_ATTEMPTS) {
      return new Error(`Redis ${kind} reconnect attempts exceeded`);
    }

    const delay = Math.min(
      env.REDIS_RETRY_MAX_DELAY_MS,
      env.REDIS_RETRY_BASE_DELAY_MS * 2 ** retries,
    );
    return delay;
  };

const createRedisConnection = (kind: RedisConnectionKind): RedisClient => {
  const socketTimeout =
    kind === "subscriber" ? undefined : env.REDIS_SOCKET_TIMEOUT_MS;

  const client = createClient({
    url: env.REDIS_URL,
    socket: {
      connectTimeout: env.REDIS_CONNECT_TIMEOUT_MS,
      socketTimeout,
      reconnectStrategy: reconnectStrategy(kind),
    },
  });

  client.on("error", (error) => {
    logger.error(
      {
        err: error,
        redisConnection: kind,
      },
      "Redis client error",
    );
  });

  return client;
};

const clients: Partial<Record<RedisConnectionKind, RedisClient>> = {};
const connectPromises: Partial<
  Record<RedisConnectionKind, Promise<RedisClient>>
> = {};

const getConnectedClient = async (
  kind: RedisConnectionKind,
): Promise<RedisClient> => {
  const existingClient = clients[kind];
  if (existingClient?.isOpen) {
    return existingClient;
  }

  const pendingConnection = connectPromises[kind];
  if (pendingConnection) {
    return pendingConnection;
  }

  const client = existingClient ?? createRedisConnection(kind);
  clients[kind] = client;

  const connectPromise = (async () => {
    if (!client.isOpen) {
      await client.connect();
      logger.info(
        {
          redisConnection: kind,
        },
        "Redis connection established",
      );
    }

    return client;
  })();

  connectPromises[kind] = connectPromise;

  try {
    return await connectPromise;
  } finally {
    connectPromises[kind] = undefined;
  }
};

export const getRedisCommandClient = (): Promise<RedisClient> =>
  getConnectedClient("command");

export const getRedisPublisherClient = (): Promise<RedisClient> =>
  getConnectedClient("publisher");

export const getRedisSubscriberClient = (): Promise<RedisClient> =>
  getConnectedClient("subscriber");

export const closeRedisClients = async (): Promise<void> => {
  const kinds: RedisConnectionKind[] = ["command", "publisher", "subscriber"];

  await Promise.allSettled(
    kinds.map(async (kind) => {
      const client = clients[kind];
      if (!client) {
        return;
      }

      try {
        if (client.isOpen) {
          await client.quit();
          logger.info(
            {
              redisConnection: kind,
            },
            "Redis connection closed",
          );
        }
      } catch (error) {
        logger.warn(
          {
            err: error,
            redisConnection: kind,
          },
          "Redis graceful shutdown failed; destroying connection",
        );
        client.destroy();
      } finally {
        clients[kind] = undefined;
        connectPromises[kind] = undefined;
      }
    }),
  );
};
