import { createHash } from "node:crypto";
import { readFile, watch } from "node:fs/promises";
import { logger } from "#/infrastructure/observability/logger";
import {
  type HtshadowResyncDeps,
  resyncHtshadowUsers,
} from "./htshadow-resync.service";

const DEBOUNCE_MS = 500;
const FALLBACK_POLL_INTERVAL_MS = 60_000;

const computeFileHash = async (filePath: string): Promise<string> => {
  try {
    const content = await readFile(filePath, "utf-8");
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return "";
  }
};

/** Wildfire never writes to htshadow; this watcher resyncs when the file changes (external updates). */
export const startHtshadowFileWatcher = async (
  deps: HtshadowResyncDeps,
): Promise<{ stop: () => void }> => {
  let lastHash = await computeFileHash(deps.htshadowPath);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let resyncInProgress = false;
  let stopped = false;

  const tryResync = async (): Promise<void> => {
    if (resyncInProgress || stopped) return;

    const newHash = await computeFileHash(deps.htshadowPath);
    if (newHash === lastHash) return;

    lastHash = newHash;
    resyncInProgress = true;

    try {
      logger.info(
        {
          event: "htshadow.watcher.resync_triggered",
          component: "htshadow-watcher",
        },
        "HTSHADOW file change detected, triggering resync",
      );
      await resyncHtshadowUsers(deps);
    } catch (error) {
      logger.error(
        {
          event: "htshadow.watcher.resync_error",
          component: "htshadow-watcher",
          error: error instanceof Error ? error.message : String(error),
        },
        "HTSHADOW resync failed",
      );
    } finally {
      resyncInProgress = false;
    }
  };

  const debouncedResync = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void tryResync();
    }, DEBOUNCE_MS);
  };

  // Start fs.watch
  const ac = new AbortController();

  void (async () => {
    try {
      const watcher = watch(deps.htshadowPath, { signal: ac.signal });
      for await (const _event of watcher) {
        if (stopped) break;
        debouncedResync();
      }
    } catch (error) {
      if (
        !stopped &&
        !(error instanceof Error && error.name === "AbortError")
      ) {
        logger.warn(
          {
            event: "htshadow.watcher.watch_error",
            component: "htshadow-watcher",
            error: error instanceof Error ? error.message : String(error),
          },
          "HTSHADOW file watcher error — fallback poll will continue",
        );
      }
    }
  })();

  // Periodic fallback poll
  const pollInterval = setInterval(() => {
    if (!stopped) void tryResync();
  }, FALLBACK_POLL_INTERVAL_MS);

  const stop = (): void => {
    stopped = true;
    ac.abort();
    if (debounceTimer) clearTimeout(debounceTimer);
    clearInterval(pollInterval);
    logger.info(
      {
        event: "htshadow.watcher.stopped",
        component: "htshadow-watcher",
      },
      "HTSHADOW file watcher stopped",
    );
  };

  logger.info(
    {
      event: "htshadow.watcher.started",
      component: "htshadow-watcher",
      path: deps.htshadowPath,
      pollIntervalMs: FALLBACK_POLL_INTERVAL_MS,
    },
    `HTSHADOW file watcher started for ${deps.htshadowPath}`,
  );

  return { stop };
};
