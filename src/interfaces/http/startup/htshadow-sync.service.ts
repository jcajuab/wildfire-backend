import { createHash } from "node:crypto";
import { readFile, rename, watch, writeFile } from "node:fs/promises";
import { type AuthSessionRepository } from "#/application/ports/auth";
import {
  type RoleRepository,
  type UserRepository,
  type UserRoleRepository,
} from "#/application/ports/rbac";
import { logger } from "#/infrastructure/observability/logger";
import { normalizeUsername } from "#/shared/string-utils";

// --- Parse phase ---

/**
 * Parses htshadow file content into a username-to-hash map.
 * Format: "username:hash" per line.
 */
export const parseHtshadow = (input: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [rawUsername, rawHash] = trimmed.split(":", 2);
    const username = normalizeUsername(rawUsername ?? "");
    const hash = rawHash?.trim();
    if (!username || !hash) continue;
    out.set(username, hash);
  }
  return out;
};

/**
 * Reads htshadow file from disk and parses it into a map.
 * Returns empty map if file does not exist (ENOENT).
 */
export const readHtshadowMap = async (
  path: string,
): Promise<Map<string, string>> => {
  try {
    const raw = await readFile(path, "utf-8");
    return parseHtshadow(raw);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return new Map<string, string>();
    }
    throw error;
  }
};

/**
 * Writes htshadow entries to disk atomically.
 * Entries are sorted by username for deterministic output.
 *
 * For external tooling only (e.g. seed scripts). Wildfire application code must
 * not write to htshadow; invited users are stored in the DB only.
 */
export const writeHtshadowMap = async (
  path: string,
  entries: ReadonlyMap<string, string>,
): Promise<void> => {
  const lines = [...entries.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([username, hash]) => `${username}:${hash}`);
  const output = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  const tmpPath = `${path}.tmp.${Date.now()}`;
  await writeFile(tmpPath, output, "utf-8");
  await rename(tmpPath, path);
};

// --- Watch phase ---

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

// --- Import phase ---

/**
 * Derives a display name from a username.
 * Capitalizes first letter, or returns "User" if empty.
 */
export const deriveUserName = (username: string): string => {
  const trimmed = username.trim();
  if (!trimmed) {
    return "User";
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
};

export interface HtshadowUserImportMetrics {
  importedUserCount: number;
  skippedExistingUsers: number;
  viewerRoleAssignedCount: number;
}

/**
 * Imports users from htshadow file into the user directory.
 * Skips admin user and users that already exist.
 * Assigns Viewer role to new users without any roles.
 */
export const importHtshadowUsers = async (deps: {
  userRepository: UserRepository;
  roleRepository: RoleRepository;
  userRoleRepository: UserRoleRepository;
  usernames: readonly string[];
  adminUsername: string;
}): Promise<HtshadowUserImportMetrics> => {
  const result: HtshadowUserImportMetrics = {
    importedUserCount: 0,
    skippedExistingUsers: 0,
    viewerRoleAssignedCount: 0,
  };

  const roles = await deps.roleRepository.list();
  const viewerRole = roles.find((r) => r.name === "Viewer") ?? null;

  for (const username of deps.usernames) {
    if (username === deps.adminUsername) {
      continue;
    }
    const existing = await deps.userRepository.findByUsername(username);
    if (existing) {
      result.skippedExistingUsers += 1;
      continue;
    }
    result.importedUserCount += 1;
    const newUser = await deps.userRepository.create({
      username,
      email: null,
      name: deriveUserName(username),
      isActive: true,
    });

    if (viewerRole) {
      const existingRoles = await deps.userRoleRepository.listRolesByUserId(
        newUser.id,
      );
      if (existingRoles.length === 0) {
        await deps.userRoleRepository.setUserRoles(newUser.id, [viewerRole.id]);
        result.viewerRoleAssignedCount += 1;
      }
    }
  }
  return result;
};

// --- Resync phase ---

const DELETION_SAFETY_THRESHOLD = 0.5;

export interface HtshadowResyncMetrics {
  added: number;
  deleted: number;
  deletionSkipped: boolean;
}

export interface HtshadowResyncDeps {
  htshadowPath: string;
  userRepository: UserRepository;
  roleRepository: RoleRepository;
  userRoleRepository: UserRoleRepository;
  authSessionRepository: AuthSessionRepository;
  dbCredentialsRepository: {
    listUserIdsWithPasswordHash(): Promise<string[]>;
  };
}

export const resyncHtshadowUsers = async (
  deps: HtshadowResyncDeps,
): Promise<HtshadowResyncMetrics> => {
  const metrics: HtshadowResyncMetrics = {
    added: 0,
    deleted: 0,
    deletionSkipped: false,
  };

  const htshadowMap = await readHtshadowMap(deps.htshadowPath);
  const htshadowUsernames = new Set(htshadowMap.keys());

  // Get WILDFIRE user IDs (those with DB credentials: admin + invited)
  const wildfireUserIds = new Set(
    await deps.dbCredentialsRepository.listUserIdsWithPasswordHash(),
  );

  // List all DCISM users (invitedAt IS NULL and not in password_hashes)
  const allUsers = await deps.userRepository.list();
  const dcismUsers = allUsers.filter(
    (u) => u.invitedAt == null && !wildfireUserIds.has(u.id),
  );

  // --- Add phase ---
  const existingUsernames = new Set(allUsers.map((u) => u.username));
  const roles = await deps.roleRepository.list();
  const viewerRole = roles.find((r) => r.name === "Viewer") ?? null;

  for (const username of htshadowUsernames) {
    if (existingUsernames.has(username)) continue;

    const newUser = await deps.userRepository.create({
      username,
      email: null,
      name: deriveUserName(username),
      isActive: true,
    });

    if (viewerRole) {
      const existingRoles = await deps.userRoleRepository.listRolesByUserId(
        newUser.id,
      );
      if (existingRoles.length === 0) {
        await deps.userRoleRepository.setUserRoles(newUser.id, [viewerRole.id]);
      }
    }

    metrics.added += 1;
  }

  // --- Delete phase ---
  const usersToDelete = dcismUsers.filter(
    (u) => !htshadowUsernames.has(u.username),
  );

  if (usersToDelete.length > 0) {
    const deletionRatio = usersToDelete.length / dcismUsers.length;

    if (deletionRatio > DELETION_SAFETY_THRESHOLD) {
      logger.warn(
        {
          event: "htshadow.resync.deletion_skipped",
          component: "htshadow-resync",
          toDelete: usersToDelete.length,
          totalDcismUsers: dcismUsers.length,
          ratio: deletionRatio,
          threshold: DELETION_SAFETY_THRESHOLD,
        },
        `Skipping HTSHADOW resync deletions: would remove ${usersToDelete.length}/${dcismUsers.length} DCISM users (>${DELETION_SAFETY_THRESHOLD * 100}% threshold)`,
      );
      metrics.deletionSkipped = true;
    } else {
      for (const user of usersToDelete) {
        await deps.authSessionRepository.revokeAllForUser(user.id);
        await deps.userRepository.delete(user.id);
        metrics.deleted += 1;
        logger.info(
          {
            event: "htshadow.resync.user_deleted",
            component: "htshadow-resync",
            username: user.username,
            userId: user.id,
          },
          `Deleted DCISM user removed from HTSHADOW: ${user.username}`,
        );
      }
    }
  }

  logger.info(
    {
      event: "htshadow.resync.complete",
      component: "htshadow-resync",
      ...metrics,
    },
    `HTSHADOW resync complete: added=${metrics.added}, deleted=${metrics.deleted}, deletionSkipped=${metrics.deletionSkipped}`,
  );

  return metrics;
};
