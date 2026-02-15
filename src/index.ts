import { env } from "#/env";
import { app, stopHttpBackgroundWorkers } from "#/interfaces/http";

let isShuttingDown = false;

const handleShutdown = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  try {
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

export default {
  port: env.PORT,
  fetch: app.fetch,
};
