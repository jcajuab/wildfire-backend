import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import {
  app,
  stopHttpBackgroundWorkers,
  syncAuthIdentityOnStartup,
} from "#/interfaces/http";

let isShuttingDown = false;
let server: ReturnType<typeof Bun.serve> | null = null;

const handleShutdown = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  try {
    if (server) {
      server.stop(true);
    }
    await stopHttpBackgroundWorkers();
    process.exit(0);
  } catch {
    process.exit(1);
  }
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void handleShutdown();
  });
}

if (import.meta.main) {
  try {
    await syncAuthIdentityOnStartup();
    logger.info(
      {
        component: "api-bootstrap",
        event: "startup.auth_identity_sync.succeeded",
      },
      "Startup auth identity sync completed",
    );
  } catch (error) {
    logger.error(
      addErrorContext(
        {
          service: "wildfire",
          component: "api-bootstrap",
          event: "startup.auth_identity_sync.failed",
        },
        error,
      ),
      "Startup auth identity sync failed",
    );
    process.exit(1);
  }

  server = Bun.serve({
    port: env.PORT,
    idleTimeout: env.IDLE_TIMEOUT_MS,
    fetch: app.fetch,
  });

  logger.info(
    {
      component: "api",
      event: "server.started",
      idleTimeoutMs: env.IDLE_TIMEOUT_MS,
      port: env.PORT,
      serverUrl: server.url.toString(),
    },
    "HTTP server started",
  );
}
