import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";
import { app, stopHttpBackgroundWorkers } from "#/interfaces/http";

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
  server = Bun.serve({
    port: env.PORT,
    fetch: app.fetch,
  });

  logger.info(
    {
      port: env.PORT,
      serverUrl: server.url.toString(),
    },
    "HTTP server started",
  );
}
