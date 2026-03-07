import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
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

const healthyDependencyCheck: HealthDependencyCheck = async () => ({
  ok: true,
});

export interface HealthDependencyChecks {
  checkMySql: HealthDependencyCheck;
  checkRedis: HealthDependencyCheck;
  checkAuditStream: HealthDependencyCheck;
  checkStorage: HealthDependencyCheck;
}

export const createHealthRouter = (
  checks: Partial<HealthDependencyChecks> = {},
): Hono => {
  const { checkMySql, checkRedis, checkAuditStream, checkStorage } = {
    checkMySql: healthyDependencyCheck,
    checkRedis: healthyDependencyCheck,
    checkAuditStream: healthyDependencyCheck,
    checkStorage: healthyDependencyCheck,
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
