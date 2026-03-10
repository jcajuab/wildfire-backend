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
  ensureRootHtshadowEntry,
  ensureRootRoleAndPermission,
  ensureRootUser,
  type RootRolePermissionSyncMetrics,
  type RootUserSyncMetrics,
} from "./root-identity-manager.service";
import {
  buildStartupContext,
  normalizeRootIdentity,
  runStartupPhase,
  type StartupRootIdentity,
  validateRootIdentity,
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
  rootIdentity: StartupRootIdentity;
}

type RootRolePermissionSyncState = RootRolePermissionSyncMetrics & {
  rootRoleId: string;
  rootPermissionId: string;
};

interface HtshadowSyncState {
  map: Map<string, string>;
  rootHtshadowUpdated: boolean;
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

const syncRootRoleAndPermission = (
  runner: AuthIdentityPhaseRunner,
  permissionSyncResult: PermissionSyncMetrics,
): Promise<RootRolePermissionSyncState> =>
  runAuthIdentityPhase(runner, {
    operation: "root-role-permission-sync",
    action: () =>
      ensureRootRoleAndPermission({
        roleRepository: runner.repositories.roleRepository,
        permissionRepository: runner.repositories.permissionRepository,
        rolePermissionRepository: runner.repositories.rolePermissionRepository,
      }),
    metadata: {
      rootPermissionAction:
        permissionSyncResult.created > 0 ? "upserted" : "already-present",
    },
  });

const syncRootHtshadow = async (
  runner: AuthIdentityPhaseRunner,
): Promise<HtshadowSyncState> => {
  const map = await runAuthIdentityPhase(runner, {
    operation: "htshadow-load",
    action: () => readHtshadowMap(runner.rootIdentity.htshadowPath),
  });
  const rootHtshadowUpdated = await runAuthIdentityPhase(runner, {
    operation: "root-htshadow-sync",
    action: () =>
      ensureRootHtshadowEntry({
        htshadowPath: runner.rootIdentity.htshadowPath,
        rootUsername: runner.rootIdentity.username,
        rootPassword: runner.rootIdentity.password,
        map,
      }),
    metadata: {
      rootUsername: runner.rootIdentity.username,
      htshadowPath: runner.rootIdentity.htshadowPath,
    },
  });

  return {
    map,
    rootHtshadowUpdated,
  };
};

const syncRootUserIdentity = (
  runner: AuthIdentityPhaseRunner,
  rootRoleId: string,
): Promise<RootUserSyncMetrics> =>
  runAuthIdentityPhase(runner, {
    operation: "root-user-sync",
    action: () =>
      ensureRootUser({
        userRepository: runner.repositories.userRepository,
        userRoleRepository: runner.repositories.userRoleRepository,
        rootRoleId,
        rootUsername: runner.rootIdentity.username,
        rootEmail: runner.rootIdentity.email,
      }),
    metadata: {
      rootUsername: runner.rootIdentity.username,
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
    rootRoleId: string;
    rootPermissionId: string;
  },
): Promise<HtshadowUserImportMetrics> =>
  runAuthIdentityPhase(runner, {
    operation: "htshadow-user-import",
    action: () =>
      importHtshadowUsers({
        userRepository: runner.repositories.userRepository,
        usernames: input.usernames,
        rootUsername: runner.rootIdentity.username,
      }),
    metadata: {
      importedFromHtshadow: input.usernames.length,
      rootRoleId: input.rootRoleId,
      rootPermissionId: input.rootPermissionId,
    },
  });

const logAuthIdentitySyncCompletion = async (input: {
  runner: AuthIdentityPhaseRunner;
  runStartedAtMs: number;
  permissionSyncResult: PermissionSyncMetrics;
  rootSyncState: RootRolePermissionSyncState;
  htshadowSyncState: HtshadowSyncState;
  rootUserSyncResult: RootUserSyncMetrics;
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
      createdRootRole: input.rootSyncState.createdRootRole,
      createdRootPermission: input.rootSyncState.createdRootPermission,
      assignedRootPermissionToRootRole:
        input.rootSyncState.assignedRootPermissionToRootRole,
      rootPermissionPurgedFromOtherRoles:
        input.rootSyncState.rootPermissionPurgedFromOtherRoles,
      rootHtshadowUpdated: input.htshadowSyncState.rootHtshadowUpdated,
      rootUserCreated: input.rootUserSyncResult.rootUserCreated,
      rootUserUpdated: input.rootUserSyncResult.rootUserUpdated,
      rootRoleAssignedToRootUser:
        input.rootUserSyncResult.rootRoleAssignedToRootUser,
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
  rootUsername: string;
  rootEmail: string | null;
  rootPassword: string;
  repositories: AuthIdentitySyncRepositories;
}): Promise<void> => {
  const runId = createStartupRunId("auth-bootstrap");
  const runStartMs = Date.now();
  const rootIdentity = normalizeRootIdentity(deps);
  validateRootIdentity(rootIdentity);
  const contextBase = buildStartupContext({
    runId,
    operation: "",
  });
  const runner: AuthIdentityPhaseRunner = {
    contextBase,
    repositories: deps.repositories,
    rootIdentity,
  };
  const topLevelContext = {
    ...contextBase,
    operation: "auth-identity-sync",
  };
  logStartupPhaseStarted(topLevelContext, {
    rootUsername: rootIdentity.username,
    rootEmail: rootIdentity.email,
  });

  try {
    const permissionSyncResult = await syncCanonicalPermissions(runner);
    const rootSyncState = await syncRootRoleAndPermission(
      runner,
      permissionSyncResult,
    );
    const htshadowSyncState = await syncRootHtshadow(runner);
    const rootUserSyncResult = await syncRootUserIdentity(
      runner,
      rootSyncState.rootRoleId,
    );
    const systemRoleSyncResult = await syncPredefinedSystemRoles(runner);
    const importedUsers = await importHtshadowUsersIntoDirectory(runner, {
      usernames: [...htshadowSyncState.map.keys()],
      rootRoleId: rootSyncState.rootRoleId,
      rootPermissionId: rootSyncState.rootPermissionId,
    });

    await logAuthIdentitySyncCompletion({
      runner,
      runStartedAtMs: runStartMs,
      permissionSyncResult,
      rootSyncState,
      htshadowSyncState,
      rootUserSyncResult,
      systemRoleSyncResult,
      importedUsers,
    });
  } catch (error) {
    logStartupPhaseFailed(topLevelContext, Date.now() - runStartMs, error, {
      rootUsername: rootIdentity.username,
    });
    throw error;
  }
};
