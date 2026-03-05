import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { env } from "#/env";
import { db } from "#/infrastructure/db/client";
import { getRedisCommandClient } from "#/infrastructure/redis/client";
import { apiResponseSchema } from "#/interfaces/http/responses";

export const healthRouter = new Hono();
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
  }),
});

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const checkMySql = async (): Promise<{
  ok: boolean;
  error?: string;
}> => {
  try {
    await db.execute(sql`SELECT 1`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: toErrorMessage(error),
    };
  }
};

const checkRedis = async (): Promise<{
  ok: boolean;
  error?: string;
}> => {
  try {
    const redis = await getRedisCommandClient();
    await redis.ping();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: toErrorMessage(error),
    };
  }
};

const checkAuditStream = async (): Promise<{
  ok: boolean;
  error?: string;
}> => {
  try {
    const redis = await getRedisCommandClient();
    await redis.sendCommand(["TYPE", env.REDIS_STREAM_AUDIT_NAME]);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: toErrorMessage(error),
    };
  }
};

healthRouter.get(
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
  (c) => c.json({ status: "ok" }),
);

healthRouter.get(
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
    const [mysql, redis, auditStream] = await Promise.all([
      checkMySql(),
      checkRedis(),
      checkAuditStream(),
    ]);

    const isReady = mysql.ok && redis.ok && auditStream.ok;
    return c.json(
      {
        status: isReady ? "ok" : "degraded",
        dependencies: {
          mysql,
          redis,
          auditStream,
        },
      },
      isReady ? 200 : 503,
    );
  },
);
