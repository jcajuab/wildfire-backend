import {
  type CredentialsRepository,
  type PasswordHasher,
} from "#/application/ports/auth";
import {
  type PermissionRepository,
  type RolePermissionRepository,
  type RoleRepository,
  type UserRepository,
  type UserRoleRepository,
} from "#/application/ports/rbac";
import { PREDEFINED_SYSTEM_ROLE_TEMPLATES } from "#/domain/rbac/system-role-templates";
import { logger } from "#/infrastructure/observability/logger";
import {
  createStartupRunId,
  logStartupPhaseFailed,
  logStartupPhaseStarted,
  logStartupPhaseSucceeded,
} from "#/infrastructure/observability/startup-logging";
import {
  type AdminRolePermissionSyncMetrics,
  type AdminUserSyncMetrics,
  ensureAdminRoleAndPermission,
  ensureAdminUser,
} from "./admin-identity-manager.service";
import { readHtshadowMap } from "./htshadow-file.adapter";
import {
  type HtshadowUserImportMetrics,
  importHtshadowUsers,
} from "./htshadow-user-importer.service";
import {
  CANONICAL_PERMISSION_SEEDS,
  ensureCanonicalStandardPermissions,
  type PermissionSyncMetrics,
} from "./permission-seeder.service";
import {
  buildStartupContext,
  normalizeAdminIdentity,
  runStartupPhase,
  type StartupAdminIdentity,
  validateAdminIdentity,
} from "./startup-orchestration.helpers";
import {
  ensurePredefinedSystemRoles,
  type SystemRoleSyncMetrics,
} from "./system-role-seeder.service";

interface AuthIdentitySyncRepositories {
  userRepository: UserRepository;
  roleRepository: RoleRepository;
  permissionRepository: PermissionRepository;
  rolePermissionRepository: RolePermissionRepository;
  userRoleRepository: UserRoleRepository;
}

interface AuthIdentityPhaseRunner {
  contextBase: ReturnType<typeof buildStartupContext>;
  repositories: AuthIdentitySyncRepositories;
  adminIdentity: StartupAdminIdentity;
}

type AdminRolePermissionSyncState = AdminRolePermissionSyncMetrics & {
  adminRoleId: string;
  adminPermissionId: string;
};

interface HtshadowLoadState {
  map: Map<string, string>;
}

const runAuthIdentityPhase = <T>(
  runner: AuthIdentityPhaseRunner,
  input: {
    operation: string;
    action: () => Promise<T>;
    metadata?: Record<string, unknown>;
  },
): Promise<T> =>
  runStartupPhase({
    context: {
      ...runner.contextBase,
      operation: input.operation,
    },
    action: input.action,
    metadata: input.metadata,
  });

const syncCanonicalPermissions = (
  runner: AuthIdentityPhaseRunner,
): Promise<PermissionSyncMetrics> =>
  runAuthIdentityPhase(runner, {
    operation: "permission-sync",
    action: () =>
      ensureCanonicalStandardPermissions({
        permissionRepository: runner.repositories.permissionRepository,
      }),
    metadata: {
      targetCount: CANONICAL_PERMISSION_SEEDS.length,
    },
  });

const syncAdminRoleAndPermission = (
  runner: AuthIdentityPhaseRunner,
  permissionSyncResult: PermissionSyncMetrics,
): Promise<AdminRolePermissionSyncState> =>
  runAuthIdentityPhase(runner, {
    operation: "admin-role-permission-sync",
    action: () =>
      ensureAdminRoleAndPermission({
        roleRepository: runner.repositories.roleRepository,
        permissionRepository: runner.repositories.permissionRepository,
        rolePermissionRepository: runner.repositories.rolePermissionRepository,
      }),
    metadata: {
      adminPermissionAction:
        permissionSyncResult.created > 0 ? "upserted" : "already-present",
    },
  });

const loadHtshadowMap = async (
  runner: AuthIdentityPhaseRunner,
): Promise<HtshadowLoadState> => {
  const map = await runAuthIdentityPhase(runner, {
    operation: "htshadow-load",
    action: () => readHtshadowMap(runner.adminIdentity.htshadowPath),
  });

  return { map };
};

const syncAdminUserIdentity = (
  runner: AuthIdentityPhaseRunner,
  adminRoleId: string,
  dbCredentialsRepository: CredentialsRepository,
  passwordHasher: PasswordHasher,
): Promise<AdminUserSyncMetrics> =>
  runAuthIdentityPhase(runner, {
    operation: "admin-user-sync",
    action: () =>
      ensureAdminUser({
        userRepository: runner.repositories.userRepository,
        userRoleRepository: runner.repositories.userRoleRepository,
        adminRoleId,
        adminUsername: runner.adminIdentity.username,
        adminEmail: runner.adminIdentity.email,
        adminPassword: runner.adminIdentity.password,
        dbCredentialsRepository,
        passwordHasher,
      }),
    metadata: {
      adminUsername: runner.adminIdentity.username,
    },
  });

const syncPredefinedSystemRoles = (
  runner: AuthIdentityPhaseRunner,
): Promise<SystemRoleSyncMetrics> =>
  runAuthIdentityPhase(runner, {
    operation: "system-role-sync",
    action: () =>
      ensurePredefinedSystemRoles({
        roleRepository: runner.repositories.roleRepository,
        permissionRepository: runner.repositories.permissionRepository,
        rolePermissionRepository: runner.repositories.rolePermissionRepository,
      }),
    metadata: {
      templates: PREDEFINED_SYSTEM_ROLE_TEMPLATES.length,
    },
  });

const importHtshadowUsersIntoDirectory = (
  runner: AuthIdentityPhaseRunner,
  input: {
    usernames: readonly string[];
    adminRoleId: string;
    adminPermissionId: string;
  },
): Promise<HtshadowUserImportMetrics> =>
  runAuthIdentityPhase(runner, {
    operation: "htshadow-user-import",
    action: () =>
      importHtshadowUsers({
        userRepository: runner.repositories.userRepository,
        roleRepository: runner.repositories.roleRepository,
        userRoleRepository: runner.repositories.userRoleRepository,
        usernames: input.usernames,
        adminUsername: runner.adminIdentity.username,
      }),
    metadata: {
      importedFromHtshadow: input.usernames.length,
      adminRoleId: input.adminRoleId,
      adminPermissionId: input.adminPermissionId,
    },
  });

/**
 * Migrates invited user credentials from HTSHADOW to DB.
 * Idempotent: skips users who already have a DB credential entry.
 */
const migrateInvitedUserCredentials = async (
  runner: AuthIdentityPhaseRunner,
  htshadowMap: Map<string, string>,
  dbCredentialsRepository: CredentialsRepository & {
    hasPasswordHash?: (userId: string) => Promise<boolean>;
  },
): Promise<number> => {
  const allUsers = await runner.repositories.userRepository.list();
  const invitedUsers = allUsers.filter((u) => u.invitedAt != null);
  let migrated = 0;

  for (const user of invitedUsers) {
    // Check if already migrated
    if (dbCredentialsRepository.hasPasswordHash) {
      const alreadyMigrated = await dbCredentialsRepository.hasPasswordHash(
        user.id,
      );
      if (alreadyMigrated) continue;
    }

    // Look up hash in HTSHADOW
    const hash = htshadowMap.get(user.username);
    if (!hash) continue;

    try {
      await dbCredentialsRepository.createPasswordHash(user.username, hash);
      migrated += 1;
    } catch {
      // Already exists (race condition or duplicate) — skip
    }
  }

  if (migrated > 0) {
    logger.info(
      {
        event: "startup.credential_migration.complete",
        component: "auth-identity-sync",
        migratedCount: migrated,
        totalInvitedUsers: invitedUsers.length,
      },
      `Migrated ${migrated} invited user credentials from HTSHADOW to DB`,
    );
  }

  return migrated;
};

const logAuthIdentitySyncCompletion = async (input: {
  runner: AuthIdentityPhaseRunner;
  runStartedAtMs: number;
  permissionSyncResult: PermissionSyncMetrics;
  adminSyncState: AdminRolePermissionSyncState;
  adminUserSyncResult: AdminUserSyncMetrics;
  systemRoleSyncResult: SystemRoleSyncMetrics;
  importedUsers: HtshadowUserImportMetrics;
  credentialsMigrated: number;
}): Promise<void> => {
  const totalRoles = (await input.runner.repositories.roleRepository.list())
    .length;

  logStartupPhaseSucceeded(
    {
      ...input.runner.contextBase,
      operation: "auth-identity-sync-complete",
    },
    Date.now() - input.runStartedAtMs,
    {
      permissionSyncCreated: input.permissionSyncResult.created,
      permissionSyncUpdated: input.permissionSyncResult.updated,
      permissionSyncRemoved: input.permissionSyncResult.removed,
      permissionSyncUnchanged: input.permissionSyncResult.unchanged,
      importedUsersCreated: input.importedUsers.importedUserCount,
      importedUsersSkipped: input.importedUsers.skippedExistingUsers,
      viewerRoleAssignedCount: input.importedUsers.viewerRoleAssignedCount,
      createdAdminRole: input.adminSyncState.createdAdminRole,
      createdAdminPermission: input.adminSyncState.createdAdminPermission,
      assignedAdminPermissionToAdminRole:
        input.adminSyncState.assignedAdminPermissionToAdminRole,
      adminPermissionPurgedFromOtherRoles:
        input.adminSyncState.adminPermissionPurgedFromOtherRoles,
      adminUserCreated: input.adminUserSyncResult.adminUserCreated,
      adminUserUpdated: input.adminUserSyncResult.adminUserUpdated,
      adminRoleAssignedToAdminUser:
        input.adminUserSyncResult.adminRoleAssignedToAdminUser,
      createdSystemRoles: input.systemRoleSyncResult.createdSystemRoles,
      updatedSystemRoles: input.systemRoleSyncResult.updatedSystemRoles,
      reconciledSystemRolePermissionSets:
        input.systemRoleSyncResult.reconciledSystemRolePermissionSets,
      credentialsMigrated: input.credentialsMigrated,
      totalRoles,
      runId: input.runner.contextBase.runId,
    },
  );
};

export const runStartupAuthIdentitySync = async (deps: {
  htshadowPath: string;
  adminUsername: string;
  adminEmail: string | null;
  adminPassword: string;
  repositories: AuthIdentitySyncRepositories;
  dbCredentialsRepository: CredentialsRepository & {
    hasPasswordHash?: (userId: string) => Promise<boolean>;
  };
  passwordHasher: PasswordHasher;
}): Promise<void> => {
  const runId = createStartupRunId("auth-bootstrap");
  const runStartMs = Date.now();
  const adminIdentity = normalizeAdminIdentity(deps);
  validateAdminIdentity(adminIdentity);
  const contextBase = buildStartupContext({
    runId,
    operation: "",
  });
  const runner: AuthIdentityPhaseRunner = {
    contextBase,
    repositories: deps.repositories,
    adminIdentity,
  };
  const topLevelContext = {
    ...contextBase,
    operation: "auth-identity-sync",
  };
  logStartupPhaseStarted(topLevelContext, {
    adminUsername: adminIdentity.username,
    adminEmail: adminIdentity.email,
  });

  try {
    const permissionSyncResult = await syncCanonicalPermissions(runner);
    const adminSyncState = await syncAdminRoleAndPermission(
      runner,
      permissionSyncResult,
    );

    // Load HTSHADOW for DCISM user import (admin no longer written to HTSHADOW)
    const htshadowLoadState = await loadHtshadowMap(runner);

    const adminUserSyncResult = await syncAdminUserIdentity(
      runner,
      adminSyncState.adminRoleId,
      deps.dbCredentialsRepository,
      deps.passwordHasher,
    );
    const systemRoleSyncResult = await syncPredefinedSystemRoles(runner);
    const importedUsers = await importHtshadowUsersIntoDirectory(runner, {
      usernames: [...htshadowLoadState.map.keys()],
      adminRoleId: adminSyncState.adminRoleId,
      adminPermissionId: adminSyncState.adminPermissionId,
    });

    // Migrate invited user credentials from HTSHADOW to DB
    const credentialsMigrated = await migrateInvitedUserCredentials(
      runner,
      htshadowLoadState.map,
      deps.dbCredentialsRepository,
    );

    await logAuthIdentitySyncCompletion({
      runner,
      runStartedAtMs: runStartMs,
      permissionSyncResult,
      adminSyncState,
      adminUserSyncResult,
      systemRoleSyncResult,
      importedUsers,
      credentialsMigrated,
    });
  } catch (error) {
    logStartupPhaseFailed(topLevelContext, Date.now() - runStartMs, error, {
      adminUsername: adminIdentity.username,
    });
    throw error;
  }
};
