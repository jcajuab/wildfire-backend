import { createClient } from "redis";
import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import { redisScripts } from "#/infrastructure/redis/scripts";
import { withTimeout } from "#/shared/retry";

type RedisConnectionKind = "command" | "publisher" | "subscriber";
type RedisClient = ReturnType<typeof createClient>;
type RedisCommandTimeoutConfig = {
  operationName?: string;
  timeoutMs?: number;
};

const REDIS_COMMAND_DEFAULT_TIMEOUT_MS = Math.max(
  1_000,
  Math.floor(env.REDIS_COMMAND_TIMEOUT_MS),
);

export const executeRedisCommand = <T>(
  run: (signal: AbortSignal) => Promise<T>,
  options: RedisCommandTimeoutConfig = {},
): Promise<T> => {
  const operation = options.operationName ?? "redis command";
  const timeoutMs = options.timeoutMs ?? REDIS_COMMAND_DEFAULT_TIMEOUT_MS;
  return withTimeout(run, timeoutMs, operation);
};

const reconnectStrategy =
  (kind: RedisConnectionKind) =>
  (retries: number): number | Error => {
    if (retries >= env.REDIS_RETRY_MAX_ATTEMPTS) {
      return new Error(`Redis ${kind} reconnect attempts exceeded`);
    }

    const base = Math.min(
      env.REDIS_RETRY_MAX_DELAY_MS,
      env.REDIS_RETRY_BASE_DELAY_MS * 2 ** retries,
    );
    const jitter = 1 + Math.random() * 0.25;
    return Math.floor(base * jitter);
  };

const createRedisConnection = (kind: RedisConnectionKind): RedisClient => {
  const client = createClient({
    url: env.REDIS_URL,
    socket: {
      connectTimeout: env.REDIS_CONNECT_TIMEOUT_MS,
      socketTimeout: env.REDIS_SOCKET_TIMEOUT_MS,
      reconnectStrategy: reconnectStrategy(kind),
    },
  });

  client.on("error", (error) => {
    logger.error(
      addErrorContext(
        {
          component: "redis",
          redisConnection: kind,
          event: "redis.connection.error",
        },
        error,
      ),
      "Redis client error",
    );
  });

  return client;
};

const createScriptedCommandConnection = () => {
  const client = createClient({
    url: env.REDIS_URL,
    socket: {
      connectTimeout: env.REDIS_CONNECT_TIMEOUT_MS,
      socketTimeout: env.REDIS_SOCKET_TIMEOUT_MS,
      reconnectStrategy: reconnectStrategy("command"),
    },
    scripts: redisScripts,
  });

  client.on("error", (error) => {
    logger.error(
      addErrorContext(
        {
          component: "redis",
          redisConnection: "command",
          event: "redis.connection.error",
        },
        error,
      ),
      "Redis client error",
    );
  });

  return client;
};

type RedisScriptedClient = ReturnType<typeof createScriptedCommandConnection>;

const logRedisConnectionClosed = (
  kind: RedisConnectionKind,
  state: "closed" | "error",
  error?: unknown,
): void => {
  if (state === "closed") {
    logger.info(
      {
        component: "redis",
        event: "redis.connection.closed",
        redisConnection: kind,
      },
      "Redis connection closed",
    );
    return;
  }

  logger.warn(
    addErrorContext(
      {
        component: "redis",
        event: "redis.connection.shutdown_error",
        redisConnection: kind,
      },
      error,
    ),
    "Redis graceful shutdown failed; destroying connection",
  );
};

const clients: Partial<Record<RedisConnectionKind, RedisClient>> = {};
const connectPromises: Partial<
  Record<RedisConnectionKind, Promise<RedisClient>>
> = {};

let scriptedClient: RedisScriptedClient | undefined;
let scriptedClientConnectPromise: Promise<RedisScriptedClient> | undefined;

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

  const connectPromise = withTimeout(
    (async () => {
      if (!client.isOpen) {
        await client.connect();
        logger.info(
          {
            component: "redis",
            event: "redis.connection.established",
            redisConnection: kind,
          },
          "Redis connection established",
        );
      }

      return client;
    })(),
    Math.max(1, Math.trunc(env.REDIS_CONNECT_TIMEOUT_MS)),
    `redis ${kind} connect`,
  );

  connectPromises[kind] = connectPromise;

  try {
    return await connectPromise;
  } catch (error) {
    try {
      if (client.isOpen) {
        await client.quit();
      } else {
        client.destroy();
      }
    } catch (closeError) {
      client.destroy();
      logger.warn(
        addErrorContext(
          {
            component: "redis",
            event: "redis.connection.disconnect_error",
            redisConnection: kind,
            connectPhase: "post-connect-error",
          },
          closeError,
        ),
        "Redis client cleanup failed after connect error",
      );
    } finally {
      clients[kind] = undefined;
    }
    throw error;
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

export const getRedisScriptedCommandClient =
  async (): Promise<RedisScriptedClient> => {
    const existing = scriptedClient;
    if (existing?.isOpen) {
      return existing;
    }

    const pending = scriptedClientConnectPromise;
    if (pending) {
      return pending;
    }

    const client = existing ?? createScriptedCommandConnection();
    scriptedClient = client;

    const connectPromise = withTimeout(
      (async () => {
        if (!client.isOpen) {
          await client.connect();
          logger.info(
            {
              component: "redis",
              event: "redis.connection.established",
              redisConnection: "command",
            },
            "Redis connection established",
          );
        }
        return client;
      })(),
      Math.max(1, Math.trunc(env.REDIS_CONNECT_TIMEOUT_MS)),
      "redis scripted-command connect",
    );

    scriptedClientConnectPromise = connectPromise;

    try {
      return await connectPromise;
    } catch (error) {
      try {
        if (client.isOpen) {
          await client.quit();
        } else {
          client.destroy();
        }
      } catch (closeError) {
        client.destroy();
        logger.warn(
          addErrorContext(
            {
              component: "redis",
              event: "redis.connection.disconnect_error",
              redisConnection: "command",
              connectPhase: "post-connect-error",
            },
            closeError,
          ),
          "Redis client cleanup failed after connect error",
        );
      } finally {
        scriptedClient = undefined;
      }
      throw error;
    } finally {
      scriptedClientConnectPromise = undefined;
    }
  };

export const closeRedisClients = async (): Promise<void> => {
  const kinds: RedisConnectionKind[] = ["command", "publisher", "subscriber"];

  const closeClient = async (
    client: RedisClient | RedisScriptedClient,
    kind: RedisConnectionKind,
  ) => {
    try {
      if (client.isOpen) {
        await client.quit();
        logger.info(
          {
            component: "redis",
            event: "redis.connection.closed",
            redisConnection: kind,
          },
          "Redis connection closed",
        );
      }
    } catch (error) {
      logRedisConnectionClosed(kind, "error", error);
      client.destroy();
    }
  };

  await Promise.allSettled([
    ...kinds.map(async (kind) => {
      const client = clients[kind];
      if (!client) return;
      await closeClient(client, kind);
      clients[kind] = undefined;
      connectPromises[kind] = undefined;
    }),
    (async () => {
      const client = scriptedClient;
      if (!client) return;
      await closeClient(client, "command");
      scriptedClient = undefined;
      scriptedClientConnectPromise = undefined;
    })(),
  ]);
};
