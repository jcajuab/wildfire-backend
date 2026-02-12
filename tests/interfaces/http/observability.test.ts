import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { logger } from "#/infrastructure/observability/logger";
import {
  type ObservabilityVariables,
  requestId,
  requestLogger,
  setAction,
} from "#/interfaces/http/middleware/observability";
import { setTestEnv } from "../../helpers/env";

const bootstrap = async () => {
  setTestEnv({ JWT_SECRET: "test-secret" });
  const { app } = await import("#/interfaces/http");
  return app;
};

const makeActionApp = () => {
  const app = new Hono<{ Variables: ObservabilityVariables }>();
  app.use("*", requestId());
  app.use("*", requestLogger);

  app.get(
    "/actions",
    setAction("observability.test", {
      route: "/actions",
      resourceType: "test",
    }),
    (c) => {
      c.set("resourceId", "resource-1");
      return c.json({ ok: true });
    },
  );

  return app;
};

describe("Observability middleware", () => {
  test("adds X-Request-Id header", async () => {
    const app = await bootstrap();

    const response = await app.request("/");

    const requestId = response.headers.get("X-Request-Id");
    expect(requestId).not.toBeNull();
    expect(requestId?.length).toBeGreaterThan(0);
  });

  test("logs action metadata without sensitive headers", async () => {
    const app = makeActionApp();
    const logs: Array<{ obj: Record<string, unknown> }> = [];
    const originalInfo = logger.info;

    logger.info = ((obj: Record<string, unknown>, _msg?: string) => {
      logs.push({ obj });
    }) as typeof logger.info;

    try {
      await app.request("/actions", {
        headers: {
          Authorization: "Bearer secret-token",
          "X-API-Key": "secret-key",
        },
      });

      const entry = logs.find((log) => log.obj.action === "observability.test");
      expect(entry).toBeDefined();
      expect(entry?.obj.resourceId).toBe("resource-1");
      expect(entry?.obj).not.toHaveProperty("authorization");
      expect(entry?.obj).not.toHaveProperty("x-api-key");
    } finally {
      logger.info = originalInfo;
    }
  });
});
