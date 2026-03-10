import {
  type PermissionRepository,
  type RolePermissionRepository,
  type RoleRepository,
  type UserRepository,
  type UserRoleRepository,
} from "#/application/ports/rbac";
import { PREDEFINED_SYSTEM_ROLE_TEMPLATES } from "#/domain/rbac/system-role-templates";
import {
  createStartupRunId,
  logStartupPhaseFailed,
  logStartupPhaseStarted,
  logStartupPhaseSucceeded,
} from "#/infrastructure/observability/startup-logging";
import {
  type AdminRolePermissionSyncMetrics,
  type AdminUserSyncMetrics,
  ensureAdminHtshadowEntry,
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

interface HtshadowSyncState {
  map: Map<string, string>;
  adminHtshadowUpdated: boolean;
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

const syncAdminHtshadow = async (
  runner: AuthIdentityPhaseRunner,
): Promise<HtshadowSyncState> => {
  const map = await runAuthIdentityPhase(runner, {
    operation: "htshadow-load",
    action: () => readHtshadowMap(runner.adminIdentity.htshadowPath),
  });
  const adminHtshadowUpdated = await runAuthIdentityPhase(runner, {
    operation: "admin-htshadow-sync",
    action: () =>
      ensureAdminHtshadowEntry({
        htshadowPath: runner.adminIdentity.htshadowPath,
        adminUsername: runner.adminIdentity.username,
        adminPassword: runner.adminIdentity.password,
        map,
      }),
    metadata: {
      adminUsername: runner.adminIdentity.username,
      htshadowPath: runner.adminIdentity.htshadowPath,
    },
  });

  return {
    map,
    adminHtshadowUpdated,
  };
};

const syncAdminUserIdentity = (
  runner: AuthIdentityPhaseRunner,
  adminRoleId: string,
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

const logAuthIdentitySyncCompletion = async (input: {
  runner: AuthIdentityPhaseRunner;
  runStartedAtMs: number;
  permissionSyncResult: PermissionSyncMetrics;
  adminSyncState: AdminRolePermissionSyncState;
  htshadowSyncState: HtshadowSyncState;
  adminUserSyncResult: AdminUserSyncMetrics;
  systemRoleSyncResult: SystemRoleSyncMetrics;
  importedUsers: HtshadowUserImportMetrics;
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
      adminHtshadowUpdated: input.htshadowSyncState.adminHtshadowUpdated,
      adminUserCreated: input.adminUserSyncResult.adminUserCreated,
      adminUserUpdated: input.adminUserSyncResult.adminUserUpdated,
      adminRoleAssignedToAdminUser:
        input.adminUserSyncResult.adminRoleAssignedToAdminUser,
      createdSystemRoles: input.systemRoleSyncResult.createdSystemRoles,
      updatedSystemRoles: input.systemRoleSyncResult.updatedSystemRoles,
      reconciledSystemRolePermissionSets:
        input.systemRoleSyncResult.reconciledSystemRolePermissionSets,
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
    const htshadowSyncState = await syncAdminHtshadow(runner);
    const adminUserSyncResult = await syncAdminUserIdentity(
      runner,
      adminSyncState.adminRoleId,
    );
    const systemRoleSyncResult = await syncPredefinedSystemRoles(runner);
    const importedUsers = await importHtshadowUsersIntoDirectory(runner, {
      usernames: [...htshadowSyncState.map.keys()],
      adminRoleId: adminSyncState.adminRoleId,
      adminPermissionId: adminSyncState.adminPermissionId,
    });

    await logAuthIdentitySyncCompletion({
      runner,
      runStartedAtMs: runStartMs,
      permissionSyncResult,
      adminSyncState,
      htshadowSyncState,
      adminUserSyncResult,
      systemRoleSyncResult,
      importedUsers,
    });
  } catch (error) {
    logStartupPhaseFailed(topLevelContext, Date.now() - runStartMs, error, {
      adminUsername: adminIdentity.username,
    });
    throw error;
  }
};
