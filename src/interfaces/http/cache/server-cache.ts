import { type Context } from "hono";
import { logger } from "#/infrastructure/observability/logger";
import {
  createRedisServerCacheStore,
  getOrSetJson,
  getServerCacheVersions,
  isServerCacheEnabled,
  makeServerResponseCacheKey,
  type ServerCacheDomain,
  type ServerCacheTtl,
  serverCacheTtlSeconds,
} from "#/infrastructure/redis/server-cache";

export { invalidateServerCache } from "#/infrastructure/redis/server-cache";

const permissionShape = (payload: unknown): string => {
  if (payload == null || typeof payload !== "object") return "anonymous";
  const parsed = payload as { isAdmin?: unknown; permissions?: unknown };
  const permissions = Array.isArray(parsed.permissions)
    ? parsed.permissions
        .filter((value): value is string => typeof value === "string")
        .sort()
    : [];
  return JSON.stringify({
    isAdmin: parsed.isAdmin === true,
    permissions,
  });
};

export const jsonWithServerCache = async <T>(
  c: Context,
  options: {
    domains: readonly ServerCacheDomain[];
    ttl?: ServerCacheTtl;
    varyByPermissions?: boolean;
  },
  compute: () => Promise<T>,
): Promise<Response> => {
  c.header("Cache-Control", "private, no-store");

  if (!isServerCacheEnabled()) {
    c.header("X-Server-Cache", "BYPASS");
    return c.json(await compute());
  }

  const store = createRedisServerCacheStore();
  let computeError: unknown;
  try {
    const versions = await getServerCacheVersions(store, options.domains);
    const key = makeServerResponseCacheKey({
      method: c.req.method,
      url: c.req.url,
      domains: options.domains,
      versions,
      vary: options.varyByPermissions
        ? [permissionShape(c.get("jwtPayload"))]
        : undefined,
    });
    const result = await getOrSetJson({
      store,
      key,
      ttlSeconds: serverCacheTtlSeconds(options.ttl ?? "default"),
      compute: async () => {
        try {
          return await compute();
        } catch (error) {
          computeError = error;
          throw error;
        }
      },
    });
    c.header("X-Server-Cache", result.status);
    return c.json(result.value);
  } catch (error) {
    if (computeError !== undefined) {
      throw computeError;
    }
    logger.warn(
      { event: "server_cache.bypass", domains: options.domains, error },
      "Server cache unavailable, computing response directly",
    );
    c.header("X-Server-Cache", "BYPASS");
    return c.json(await compute());
  }
};
