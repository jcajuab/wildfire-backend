import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { env } from "#/env";
import { checkDbConnectivity } from "#/infrastructure/db/client";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";
import { S3ContentStorage } from "#/infrastructure/storage/s3-content.storage";
import { apiResponseSchema, toApiResponse } from "#/interfaces/http/responses";

export type HealthDependencyCheck = () => Promise<{
  ok: boolean;
  error?: string;
}>;

const healthTags = ["Health"];

const healthResponseSchema = z.object({
  status: z.literal("ok"),
});

const dependencyStateSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});

const healthReadyResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  dependencies: z.object({
    mysql: dependencyStateSchema,
    redis: dependencyStateSchema,
    auditStream: dependencyStateSchema,
    storage: dependencyStateSchema,
  }),
});

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const runHealthDependencyCheck = async (
  check: HealthDependencyCheck,
  operationName: string,
): Promise<{ ok: boolean; error?: string }> => {
  try {
    return await check();
  } catch (error) {
    return {
      ok: false,
      error: `${operationName}: ${toErrorMessage(error)}`,
    };
  }
};

const createStorageConnectivityCheck = (): HealthDependencyCheck => {
  const healthStorage = new S3ContentStorage({
    bucket: env.MINIO_BUCKET,
    region: env.MINIO_REGION,
    endpoint: `${env.MINIO_USE_SSL ? "https" : "http"}://${env.MINIO_ENDPOINT}:${env.MINIO_PORT}`,
    accessKeyId: env.MINIO_ROOT_USER,
    secretAccessKey: env.MINIO_ROOT_PASSWORD,
    requestTimeoutMs: env.MINIO_REQUEST_TIMEOUT_MS,
  });

  return async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const result = await healthStorage.checkConnectivity();
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    } catch (error) {
      return {
        ok: false,
        error: toErrorMessage(error),
      };
    }
  };
};

const createDefaultHealthChecks = () => {
  const dependencyChecks = {
    checkMySql: async (): Promise<{ ok: boolean; error?: string }> => {
      try {
        await checkDbConnectivity();
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: toErrorMessage(error),
        };
      }
    },
    checkRedis: async (): Promise<{ ok: boolean; error?: string }> => {
      try {
        const redis = await getRedisCommandClient();
        await executeRedisCommand<void>(redis, ["PING"], {
          timeoutMs: env.HEALTH_CHECK_TIMEOUT_MS,
          operationName: "redis ping",
        });
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: toErrorMessage(error),
        };
      }
    },
    checkAuditStream: async (): Promise<{ ok: boolean; error?: string }> => {
      try {
        const redis = await getRedisCommandClient();
        await executeRedisCommand<void>(
          redis,
          ["TYPE", env.REDIS_STREAM_AUDIT_NAME],
          {
            timeoutMs: env.HEALTH_CHECK_TIMEOUT_MS,
            operationName: "audit stream health check",
          },
        );
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: toErrorMessage(error),
        };
      }
    },
    checkStorage: createStorageConnectivityCheck(),
  };

  return dependencyChecks;
};

export type HealthDependencyChecks = ReturnType<
  typeof createDefaultHealthChecks
>;

export const createHealthRouter = (
  checks: Partial<HealthDependencyChecks> = {},
): Hono => {
  const { checkMySql, checkRedis, checkAuditStream, checkStorage } = {
    ...createDefaultHealthChecks(),
    ...checks,
  };

  const router = new Hono();

  router.get(
    "/",
    describeRoute({
      description: "Health check",
      tags: healthTags,
      responses: {
        200: {
          description: "Service healthy",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(healthResponseSchema)),
            },
          },
        },
      },
    }),
    (c) => c.json(toApiResponse({ status: "ok" })),
  );

  router.get(
    "/ready",
    describeRoute({
      description: "Dependency readiness check",
      tags: healthTags,
      responses: {
        200: {
          description: "Service and dependencies are ready",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(healthReadyResponseSchema)),
            },
          },
        },
        503: {
          description: "Service degraded due to dependency failure",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(healthReadyResponseSchema)),
            },
          },
        },
      },
    }),
    async (c) => {
      const [mysql, redis, auditStream, storage] = await Promise.all([
        runHealthDependencyCheck(checkMySql, "mysql readiness check"),
        runHealthDependencyCheck(checkRedis, "redis readiness check"),
        runHealthDependencyCheck(
          checkAuditStream,
          "audit stream readiness check",
        ),
        runHealthDependencyCheck(checkStorage, "storage readiness check"),
      ]);

      const isReady = mysql.ok && redis.ok && auditStream.ok && storage.ok;
      return c.json(
        toApiResponse({
          status: isReady ? "ok" : "degraded",
          dependencies: {
            mysql,
            redis,
            auditStream,
            storage,
          },
        }),
        isReady ? 200 : 503,
      );
    },
  );

  return router;
};

export const healthRouter = createHealthRouter();
