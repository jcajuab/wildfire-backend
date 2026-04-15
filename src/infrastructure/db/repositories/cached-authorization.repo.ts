import { type AuthorizationRepository } from "#/application/ports/rbac";
import { Permission } from "#/domain/rbac/permission";
import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";

const PERMISSIONS_TTL_SECONDS = 60;
const ADMIN_TTL_SECONDS = 60;

const permissionsKey = (userId: string): string =>
  `${env.REDIS_KEY_PREFIX}:auth:perms:${userId}`;

const adminKey = (userId: string): string =>
  `${env.REDIS_KEY_PREFIX}:auth:admin:${userId}`;

export class CachedAuthorizationRepository implements AuthorizationRepository {
  constructor(private readonly inner: AuthorizationRepository) {}

  async findPermissionsForUser(userId: string): Promise<Permission[]> {
    try {
      const redis = await getRedisCommandClient();
      const cached = await executeRedisCommand<string | null>(redis, [
        "GET",
        permissionsKey(userId),
      ]);

      if (cached != null) {
        const parsed = JSON.parse(cached) as string[];
        return parsed.map((p) => Permission.parse(p));
      }
    } catch {
      logger.warn(
        { event: "auth.cache.read_failed", userId },
        "Permission cache read failed, falling through to DB",
      );
    }

    const permissions = await this.inner.findPermissionsForUser(userId);

    try {
      const redis = await getRedisCommandClient();
      const serialized = JSON.stringify(
        permissions.map((p) => `${p.resource}:${p.action}`),
      );
      await executeRedisCommand(redis, [
        "SET",
        permissionsKey(userId),
        serialized,
        "EX",
        String(PERMISSIONS_TTL_SECONDS),
      ]);
    } catch {
      // Best-effort cache write -- DB result is already available
    }

    return permissions;
  }

  async isAdminUser(userId: string): Promise<boolean> {
    try {
      const redis = await getRedisCommandClient();
      const cached = await executeRedisCommand<string | null>(redis, [
        "GET",
        adminKey(userId),
      ]);

      if (cached != null) {
        return cached === "1";
      }
    } catch {
      logger.warn(
        { event: "auth.cache.admin_read_failed", userId },
        "Admin cache read failed, falling through to DB",
      );
    }

    const isAdmin = await this.inner.isAdminUser(userId);

    try {
      const redis = await getRedisCommandClient();
      await executeRedisCommand(redis, [
        "SET",
        adminKey(userId),
        isAdmin ? "1" : "0",
        "EX",
        String(ADMIN_TTL_SECONDS),
      ]);
    } catch {
      // Best-effort cache write
    }

    return isAdmin;
  }

  static async invalidateUser(userId: string): Promise<void> {
    try {
      const redis = await getRedisCommandClient();
      await executeRedisCommand(redis, ["DEL", permissionsKey(userId)]);
      await executeRedisCommand(redis, ["DEL", adminKey(userId)]);
    } catch {
      logger.warn(
        { event: "auth.cache.invalidation_failed", userId },
        "Permission cache invalidation failed",
      );
    }
  }
}
