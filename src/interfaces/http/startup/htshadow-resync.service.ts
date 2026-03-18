import { type AuthSessionRepository } from "#/application/ports/auth";
import {
  type RoleRepository,
  type UserRepository,
  type UserRoleRepository,
} from "#/application/ports/rbac";
import { logger } from "#/infrastructure/observability/logger";
import { readHtshadowMap } from "./htshadow-file.adapter";
import { deriveUserName } from "./htshadow-user-importer.service";

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
