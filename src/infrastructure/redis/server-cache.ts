import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";

export type ServerCacheDomain =
  | "content"
  | "playlists"
  | "schedules"
  | "displays"
  | "users"
  | "roles"
  | "permissions";

export type ServerCacheTtl = "default" | "dynamic" | "reference";

export interface ServerCacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  getMany(keys: readonly string[]): Promise<Array<string | null>>;
  increment(key: string): Promise<void>;
}

const VERSION_ZERO = "0";

const domainVersionKey = (domain: ServerCacheDomain): string =>
  `${env.REDIS_KEY_PREFIX}:cache:version:${domain}`;

const responseCacheKey = (key: string): string =>
  `${env.REDIS_KEY_PREFIX}:cache:response:${key}`;

let serverCacheEnabledForTesting: boolean | undefined;

export const setServerCacheEnabledForTesting = (
  enabled: boolean | undefined,
): void => {
  if (env.NODE_ENV !== "test") return;
  serverCacheEnabledForTesting = enabled;
};

export const isServerCacheEnabled = (): boolean =>
  serverCacheEnabledForTesting ?? env.SERVER_CACHE_ENABLED;

export const serverCacheTtlSeconds = (ttl: ServerCacheTtl): number => {
  if (ttl === "dynamic") return env.SERVER_CACHE_DYNAMIC_TTL_SECONDS;
  if (ttl === "reference") return env.SERVER_CACHE_REFERENCE_TTL_SECONDS;
  return env.SERVER_CACHE_DEFAULT_TTL_SECONDS;
};

const normalizeSearch = (url: URL): string => {
  const entries = [...url.searchParams.entries()].sort(
    ([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyDelta = leftKey.localeCompare(rightKey);
      return keyDelta === 0 ? leftValue.localeCompare(rightValue) : keyDelta;
    },
  );
  const normalized = new URLSearchParams();
  for (const [key, value] of entries) {
    normalized.append(key, value);
  }
  return normalized.toString();
};

export const buildServerCacheKey = (input: {
  method: string;
  url: string;
  domains: readonly ServerCacheDomain[];
  versions: readonly string[];
  vary?: readonly string[];
}): string => {
  const url = new URL(input.url);
  const query = normalizeSearch(url);
  const domains = input.domains
    .map(
      (domain, index) => `${domain}:${input.versions[index] ?? VERSION_ZERO}`,
    )
    .join(",");
  const vary = input.vary?.length ? `|vary:${input.vary.join("|")}` : "";
  return (
    [
      input.method.toUpperCase(),
      url.pathname,
      query,
      `domains:${domains}`,
    ].join("|") + vary
  );
};

export const createRedisServerCacheStore = (): ServerCacheStore => ({
  async get(key) {
    const redis = await getRedisCommandClient();
    return executeRedisCommand((signal) =>
      redis.withAbortSignal(signal).get(key),
    );
  },
  async set(key, value, ttlSeconds) {
    const redis = await getRedisCommandClient();
    await executeRedisCommand((signal) =>
      redis.withAbortSignal(signal).set(key, value, { EX: ttlSeconds }),
    );
  },
  async getMany(keys) {
    if (keys.length === 0) return [];
    const redis = await getRedisCommandClient();
    const values = await executeRedisCommand((signal) =>
      redis.withAbortSignal(signal).mGet([...keys]),
    );
    return values.map((value) => (typeof value === "string" ? value : null));
  },
  async increment(key) {
    const redis = await getRedisCommandClient();
    await executeRedisCommand((signal) =>
      redis.withAbortSignal(signal).incr(key),
    );
  },
});

export const getServerCacheVersions = async (
  store: ServerCacheStore,
  domains: readonly ServerCacheDomain[],
): Promise<string[]> => {
  const versions = await store.getMany(domains.map(domainVersionKey));
  return versions.map((value) => value ?? VERSION_ZERO);
};

export const getOrSetJson = async <T>(input: {
  store: ServerCacheStore;
  key: string;
  ttlSeconds: number;
  compute: () => Promise<T>;
}): Promise<{ status: "HIT" | "MISS"; value: T }> => {
  const cached = await input.store.get(input.key);
  if (cached != null) {
    return { status: "HIT", value: JSON.parse(cached) as T };
  }

  const value = await input.compute();
  await input.store.set(input.key, JSON.stringify(value), input.ttlSeconds);
  return { status: "MISS", value };
};

export const makeServerResponseCacheKey = (input: {
  method: string;
  url: string;
  domains: readonly ServerCacheDomain[];
  versions: readonly string[];
  vary?: readonly string[];
}): string => responseCacheKey(buildServerCacheKey(input));

export const invalidateServerCache = async (
  domains: readonly ServerCacheDomain[],
): Promise<void> => {
  if (!isServerCacheEnabled() || domains.length === 0) return;

  const store = createRedisServerCacheStore();
  try {
    await Promise.all(
      [...new Set(domains)].map((domain) =>
        store.increment(domainVersionKey(domain)),
      ),
    );
  } catch (error) {
    logger.warn(
      { event: "server_cache.invalidation_failed", domains, error },
      "Server cache invalidation failed",
    );
  }
};
