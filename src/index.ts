import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import {
  app,
  runStorageBootstrapChecks,
  startHttpBackgroundWorkers,
  stopHttpBackgroundWorkers,
  syncAuthIdentityOnStartup,
} from "#/interfaces/http";

let isShuttingDown = false;
let server: ReturnType<typeof Bun.serve> | null = null;

const handleShutdown = async (): Promise<void> => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  if (server) {
    server.stop(true);
  }

  await stopHttpBackgroundWorkers();
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void handleShutdown()
      .then(() => {
        process.exit(0);
      })
      .catch((error) => {
        logger.error(
          addErrorContext(
            {
              component: "api",
              event: "http.server.shutdown_failed",
              signal,
            },
            error,
          ),
          "HTTP server shutdown handler failed",
        );
        process.exit(1);
      });
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

    await runStorageBootstrapChecks();
    startHttpBackgroundWorkers();

    logger.info(
      {
        component: "api-bootstrap",
        event: "startup.background_workers.started",
      },
      "HTTP background workers started",
    );
  } catch (error) {
    logger.error(
      addErrorContext(
        {
          service: "wildfire",
          component: "api-bootstrap",
          event: "startup.initialization.failed",
        },
        error,
      ),
      "Startup initialization failed",
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
