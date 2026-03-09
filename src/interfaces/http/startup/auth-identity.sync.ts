import { readFile, rename, writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import {
  type PermissionRepository,
  type RolePermissionRepository,
  type RoleRepository,
  type UserRepository,
  type UserRoleRepository,
} from "#/application/ports/rbac";
import {
  CANONICAL_STANDARD_RESOURCE_ACTIONS,
  canonicalPermissionKey,
  ROOT_PERMISSION,
} from "#/domain/rbac/canonical-permissions";
import { PREDEFINED_SYSTEM_ROLE_TEMPLATES } from "#/domain/rbac/system-role-templates";
import {
  createStartupRunId,
  logStartupPhaseFailed,
  logStartupPhaseStarted,
  logStartupPhaseSucceeded,
  type StartupPhaseContext,
} from "#/infrastructure/observability/startup-logging";

const ROOT_ROLE_NAME = "Root";
const BCRYPT_SALT_ROUNDS = 10;
const CANONICAL_PERMISSION_SEEDS = [
  ...CANONICAL_STANDARD_RESOURCE_ACTIONS,
  ROOT_PERMISSION,
];

const normalizeUsername = (value: string): string => value.trim().toLowerCase();

const deriveUserName = (username: string): string => {
  const trimmed = username.trim();
  if (!trimmed) {
    return "User";
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
};

const uniqueIds = (values: readonly string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
};

interface PermissionSyncMetrics {
  created: number;
  updated: number;
  removed: number;
  unchanged: number;
}

interface RootRolePermissionSyncMetrics {
  createdRootRole: boolean;
  createdRootPermission: boolean;
  assignedRootPermissionToRootRole: boolean;
  rootPermissionPurgedFromOtherRoles: number;
}

interface SystemRoleSyncMetrics {
  createdSystemRoles: number;
  updatedSystemRoles: number;
  reconciledSystemRolePermissionSets: number;
}

interface RootUserSyncMetrics {
  rootUserCreated: boolean;
  rootUserUpdated: boolean;
  rootRoleAssignedToRootUser: boolean;
}

interface HtshadowUserImportMetrics {
  importedUserCount: number;
  skippedExistingUsers: number;
}

const buildStartupContext = (input: {
  runId: string;
  operation: string;
}): Omit<StartupPhaseContext, "operation"> & { operation: string } => ({
  component: "api-bootstrap",
  phase: "auth-identity",
  operation: input.operation,
  runId: input.runId,
});

const runStartupPhase = async <T>(input: {
  context: StartupPhaseContext;
  action: () => Promise<T>;
  metadata?: Record<string, unknown>;
}): Promise<T> => {
  const startedAt = Date.now();
  logStartupPhaseStarted(input.context, input.metadata);
  try {
    const result = await input.action();
    logStartupPhaseSucceeded(
      input.context,
      Date.now() - startedAt,
      input.metadata,
    );
    return result;
  } catch (error) {
    logStartupPhaseFailed(
      input.context,
      Date.now() - startedAt,
      error,
      input.metadata,
    );
    throw error;
  }
};

const ensureCanonicalStandardPermissions = async (deps: {
  permissionRepository: PermissionRepository;
}): Promise<PermissionSyncMetrics> => {
  const result: PermissionSyncMetrics = {
    created: 0,
    updated: 0,
    removed: 0,
    unchanged: 0,
  };

  const existing = await deps.permissionRepository.list();
  const existingByKey = new Map(
    existing.map((permission) => [
      canonicalPermissionKey(permission),
      permission,
    ]),
  );
  const canonicalKeys = new Set(
    CANONICAL_PERMISSION_SEEDS.map((permission) =>
      canonicalPermissionKey(permission),
    ),
  );

  for (const permission of CANONICAL_PERMISSION_SEEDS) {
    const key = canonicalPermissionKey(permission);
    const existingPermission = existingByKey.get(key);
    if (!existingPermission) {
      await deps.permissionRepository.create(permission);
      result.created += 1;
      continue;
    }

    const expectedIsRoot =
      existingPermission.resource === ROOT_PERMISSION.resource &&
      existingPermission.action === ROOT_PERMISSION.action;
    if (existingPermission.isRoot !== expectedIsRoot) {
      if (!deps.permissionRepository.updateIsRoot) {
        throw new Error(
          "permissionRepository.updateIsRoot is required for strict permission normalization",
        );
      }
      await deps.permissionRepository.updateIsRoot(
        existingPermission.id,
        expectedIsRoot,
      );
      result.updated += 1;
      continue;
    }

    result.unchanged += 1;
  }

  const stalePermissionIds = existing
    .filter(
      (permission) => !canonicalKeys.has(canonicalPermissionKey(permission)),
    )
    .map((permission) => permission.id);

  if (stalePermissionIds.length === 0) {
    return result;
  }

  if (!deps.permissionRepository.deleteByIds) {
    throw new Error(
      "permissionRepository.deleteByIds is required for strict permission normalization",
    );
  }
  await deps.permissionRepository.deleteByIds(stalePermissionIds);
  result.removed += stalePermissionIds.length;
  return result;
};

const parseHtshadow = (input: string): Map<string, string> => {
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

const readHtshadowMap = async (path: string): Promise<Map<string, string>> => {
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

const writeHtshadowMap = async (
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

const ensureRootRoleAndPermission = async (deps: {
  roleRepository: RoleRepository;
  permissionRepository: PermissionRepository;
  rolePermissionRepository: RolePermissionRepository;
}): Promise<
  RootRolePermissionSyncMetrics & {
    rootRoleId: string;
    rootPermissionId: string;
  }
> => {
  const result: RootRolePermissionSyncMetrics = {
    createdRootRole: false,
    createdRootPermission: false,
    assignedRootPermissionToRootRole: false,
    rootPermissionPurgedFromOtherRoles: 0,
  };

  const roles = await deps.roleRepository.list();
  let rootRole = roles.find((role) => role.name === ROOT_ROLE_NAME) ?? null;
  if (!rootRole) {
    result.createdRootRole = true;
    rootRole = await deps.roleRepository.create({
      name: ROOT_ROLE_NAME,
      description: "Global root access",
      isSystem: true,
    });
  }

  const permissions = await deps.permissionRepository.list();
  let rootPermission =
    permissions.find(
      (permission) =>
        permission.resource === ROOT_PERMISSION.resource &&
        permission.action === ROOT_PERMISSION.action,
    ) ?? null;

  if (!rootPermission) {
    result.createdRootPermission = true;
    rootPermission = await deps.permissionRepository.create(ROOT_PERMISSION);
  } else if (rootPermission.isRoot !== true) {
    if (!deps.permissionRepository.updateIsRoot) {
      throw new Error(
        "permissionRepository.updateIsRoot is required for root permission enforcement",
      );
    }
    await deps.permissionRepository.updateIsRoot(rootPermission.id, true);
    rootPermission = { ...rootPermission, isRoot: true };
  }

  const rootRoleAssignments =
    await deps.rolePermissionRepository.listPermissionsByRoleId(rootRole.id);
  const rootPermissionIds = rootRoleAssignments.map(
    (assignment) => assignment.permissionId,
  );
  const hasExactRootPermissionOnly =
    rootPermissionIds.length === 1 &&
    rootPermissionIds[0] === rootPermission.id;
  if (!hasExactRootPermissionOnly) {
    result.assignedRootPermissionToRootRole = true;
    await deps.rolePermissionRepository.setRolePermissions(rootRole.id, [
      rootPermission.id,
    ]);
  }

  for (const role of roles) {
    if (role.id === rootRole.id) {
      continue;
    }
    const assignments =
      await deps.rolePermissionRepository.listPermissionsByRoleId(role.id);
    const permissionIds = assignments.map(
      (assignment) => assignment.permissionId,
    );
    if (!permissionIds.includes(rootPermission.id)) {
      continue;
    }
    result.rootPermissionPurgedFromOtherRoles += 1;
    const nextPermissionIds = uniqueIds(
      permissionIds.filter(
        (permissionId) => permissionId !== rootPermission.id,
      ),
    );
    await deps.rolePermissionRepository.setRolePermissions(
      role.id,
      nextPermissionIds,
    );
  }

  return {
    ...result,
    rootRoleId: rootRole.id,
    rootPermissionId: rootPermission.id,
  };
};

const ensureRootUser = async (deps: {
  userRepository: UserRepository;
  userRoleRepository: UserRoleRepository;
  rootRoleId: string;
  rootUsername: string;
  rootEmail: string | null;
}): Promise<RootUserSyncMetrics> => {
  const result: RootUserSyncMetrics = {
    rootUserCreated: false,
    rootUserUpdated: false,
    rootRoleAssignedToRootUser: false,
  };

  const expectedName = deriveUserName(deps.rootUsername);
  let rootUser = await deps.userRepository.findByUsername(deps.rootUsername);

  if (!rootUser) {
    rootUser = await deps.userRepository.create({
      username: deps.rootUsername,
      email: deps.rootEmail,
      name: expectedName,
      isActive: true,
    });
    result.rootUserCreated = true;
  } else {
    const shouldUpdate =
      rootUser.email !== deps.rootEmail ||
      rootUser.name !== expectedName ||
      rootUser.isActive !== true;
    if (shouldUpdate) {
      rootUser =
        (await deps.userRepository.update(rootUser.id, {
          email: deps.rootEmail,
          name: expectedName,
          isActive: true,
        })) ?? rootUser;
      result.rootUserUpdated = true;
    }
  }

  const currentAssignments = await deps.userRoleRepository.listRolesByUserId(
    rootUser.id,
  );
  const roleIds = currentAssignments.map((assignment) => assignment.roleId);
  const hasExactRootRoleOnly =
    roleIds.length === 1 && roleIds[0] === deps.rootRoleId;
  if (!hasExactRootRoleOnly) {
    result.rootRoleAssignedToRootUser = true;
    await deps.userRoleRepository.setUserRoles(rootUser.id, [deps.rootRoleId]);
  }

  const users = await deps.userRepository.list();
  for (const user of users) {
    if (user.id === rootUser.id) {
      continue;
    }
    const assignments = await deps.userRoleRepository.listRolesByUserId(
      user.id,
    );
    const userRoleIds = assignments.map((assignment) => assignment.roleId);
    if (!userRoleIds.includes(deps.rootRoleId)) {
      continue;
    }
    const nextRoleIds = uniqueIds(
      userRoleIds.filter((roleId) => roleId !== deps.rootRoleId),
    );
    await deps.userRoleRepository.setUserRoles(user.id, nextRoleIds);
  }

  return result;
};

const hasExactIdSet = (
  actual: readonly string[],
  expected: readonly string[],
): boolean => {
  if (actual.length !== expected.length) {
    return false;
  }
  const expectedSet = new Set(expected);
  for (const value of actual) {
    if (!expectedSet.has(value)) {
      return false;
    }
  }
  return true;
};

const ensurePredefinedSystemRoles = async (deps: {
  roleRepository: RoleRepository;
  permissionRepository: PermissionRepository;
  rolePermissionRepository: RolePermissionRepository;
}): Promise<SystemRoleSyncMetrics> => {
  const result: SystemRoleSyncMetrics = {
    createdSystemRoles: 0,
    updatedSystemRoles: 0,
    reconciledSystemRolePermissionSets: 0,
  };

  const permissions = await deps.permissionRepository.list();
  const permissionIdByKey = new Map(
    permissions.map((permission) => [
      canonicalPermissionKey(permission),
      permission.id,
    ]),
  );
  const roles = await deps.roleRepository.list();
  const rolesByName = new Map(roles.map((role) => [role.name, role]));

  for (const template of PREDEFINED_SYSTEM_ROLE_TEMPLATES) {
    const desiredPermissionIds = template.permissionKeys.map((key) => {
      const permissionId = permissionIdByKey.get(key);
      if (!permissionId) {
        throw new Error(
          `Cannot reconcile predefined system role '${template.name}'. Missing permission '${key}'.`,
        );
      }
      return permissionId;
    });

    let role = rolesByName.get(template.name) ?? null;
    if (!role) {
      role = await deps.roleRepository.create({
        name: template.name,
        description: template.description,
        isSystem: true,
      });
      rolesByName.set(role.name, role);
      result.createdSystemRoles += 1;
    } else if (
      role.description !== template.description ||
      role.isSystem !== true
    ) {
      const updatedRole = await deps.roleRepository.update(role.id, {
        description: template.description,
        isSystem: true,
      });
      if (!updatedRole) {
        throw new Error(
          `Cannot reconcile predefined system role '${template.name}'. Role disappeared during update.`,
        );
      }
      role = updatedRole;
      rolesByName.set(role.name, role);
      result.updatedSystemRoles += 1;
    }

    const existingAssignments =
      await deps.rolePermissionRepository.listPermissionsByRoleId(role.id);
    const existingPermissionIds = existingAssignments.map(
      (assignment) => assignment.permissionId,
    );
    if (!hasExactIdSet(existingPermissionIds, desiredPermissionIds)) {
      await deps.rolePermissionRepository.setRolePermissions(
        role.id,
        uniqueIds(desiredPermissionIds),
      );
      result.reconciledSystemRolePermissionSets += 1;
    }
  }

  return result;
};

const importHtshadowUsers = async (deps: {
  userRepository: UserRepository;
  usernames: readonly string[];
  rootUsername: string;
}): Promise<HtshadowUserImportMetrics> => {
  const result: HtshadowUserImportMetrics = {
    importedUserCount: 0,
    skippedExistingUsers: 0,
  };
  for (const username of deps.usernames) {
    if (username === deps.rootUsername) {
      continue;
    }
    const existing = await deps.userRepository.findByUsername(username);
    if (existing) {
      result.skippedExistingUsers += 1;
      continue;
    }
    result.importedUserCount += 1;
    await deps.userRepository.create({
      username,
      email: null,
      name: deriveUserName(username),
      isActive: true,
    });
  }
  return result;
};

const ensureRootHtshadowEntry = async (input: {
  htshadowPath: string;
  rootUsername: string;
  rootPassword: string;
  map: Map<string, string>;
}): Promise<boolean> => {
  const currentHash = input.map.get(input.rootUsername);
  const isCurrentValid =
    currentHash != null
      ? await bcrypt.compare(input.rootPassword, currentHash)
      : false;
  if (isCurrentValid) {
    return false;
  }
  const nextHash = await bcrypt.hash(input.rootPassword, BCRYPT_SALT_ROUNDS);
  input.map.set(input.rootUsername, nextHash);
  await writeHtshadowMap(input.htshadowPath, input.map);
  return true;
};

export const runStartupAuthIdentitySync = async (deps: {
  htshadowPath: string;
  rootUsername: string;
  rootEmail: string | null;
  rootPassword: string;
  repositories: {
    userRepository: UserRepository;
    roleRepository: RoleRepository;
    permissionRepository: PermissionRepository;
    rolePermissionRepository: RolePermissionRepository;
    userRoleRepository: UserRoleRepository;
  };
}): Promise<void> => {
  const runId = createStartupRunId("auth-bootstrap");
  const runStartMs = Date.now();
  const rootUsername = normalizeUsername(deps.rootUsername);
  const rootEmail = deps.rootEmail?.trim().toLowerCase() ?? null;
  const rootPassword = deps.rootPassword.trim();

  if (!rootUsername) {
    throw new Error("ROOT_USERNAME must not be empty.");
  }
  if (!rootPassword) {
    throw new Error("ROOT_PASSWORD must not be empty.");
  }
  if (rootEmail != null && !rootEmail.includes("@")) {
    throw new Error("ROOT_EMAIL must be a valid email when provided.");
  }

  const contextBase = buildStartupContext({
    runId,
    operation: "",
  });
  const topLevelContext = {
    ...contextBase,
    operation: "auth-identity-sync",
  };
  logStartupPhaseStarted(topLevelContext, {
    rootUsername,
    rootEmail,
  });

  try {
    const permissionSyncResult = await runStartupPhase({
      context: {
        ...contextBase,
        operation: "permission-sync",
      },
      action: () =>
        ensureCanonicalStandardPermissions({
          permissionRepository: deps.repositories.permissionRepository,
        }),
      metadata: {
        targetCount: CANONICAL_PERMISSION_SEEDS.length,
      },
    });

    const rootSyncState = await runStartupPhase({
      context: {
        ...contextBase,
        operation: "root-role-permission-sync",
      },
      action: () =>
        ensureRootRoleAndPermission({
          roleRepository: deps.repositories.roleRepository,
          permissionRepository: deps.repositories.permissionRepository,
          rolePermissionRepository: deps.repositories.rolePermissionRepository,
        }),
      metadata: {
        rootPermissionAction:
          permissionSyncResult.created > 0 ? "upserted" : "already-present",
      },
    });

    const htshadowMap = await runStartupPhase({
      context: {
        ...contextBase,
        operation: "htshadow-load",
      },
      action: () => readHtshadowMap(deps.htshadowPath),
    });

    const rootHtshadowUpdated = await runStartupPhase({
      context: {
        ...contextBase,
        operation: "root-htshadow-sync",
      },
      action: () =>
        ensureRootHtshadowEntry({
          htshadowPath: deps.htshadowPath,
          rootUsername,
          rootPassword,
          map: htshadowMap,
        }),
      metadata: {
        rootUsername,
        htshadowPath: deps.htshadowPath,
      },
    });

    const rootUserSyncResult = await runStartupPhase({
      context: {
        ...contextBase,
        operation: "root-user-sync",
      },
      action: () =>
        ensureRootUser({
          userRepository: deps.repositories.userRepository,
          userRoleRepository: deps.repositories.userRoleRepository,
          rootRoleId: rootSyncState.rootRoleId,
          rootUsername,
          rootEmail,
        }),
      metadata: {
        rootUsername,
      },
    });

    const systemRoleSyncResult = await runStartupPhase({
      context: {
        ...contextBase,
        operation: "system-role-sync",
      },
      action: () =>
        ensurePredefinedSystemRoles({
          roleRepository: deps.repositories.roleRepository,
          permissionRepository: deps.repositories.permissionRepository,
          rolePermissionRepository: deps.repositories.rolePermissionRepository,
        }),
      metadata: {
        templates: PREDEFINED_SYSTEM_ROLE_TEMPLATES.length,
      },
    });

    const importedUsers = await runStartupPhase({
      context: {
        ...contextBase,
        operation: "htshadow-user-import",
      },
      action: () =>
        importHtshadowUsers({
          userRepository: deps.repositories.userRepository,
          usernames: [...htshadowMap.keys()],
          rootUsername,
        }),
      metadata: {
        importedFromHtshadow: htshadowMap.size,
        rootRoleId: rootSyncState.rootRoleId,
        rootPermissionId: rootSyncState.rootPermissionId,
      },
    });

    const totalRolesCount = (await deps.repositories.roleRepository.list())
      .length;
    logStartupPhaseSucceeded(
      {
        ...contextBase,
        operation: "auth-identity-sync-complete",
      },
      Date.now() - runStartMs,
      {
        permissionSyncCreated: permissionSyncResult.created,
        permissionSyncUpdated: permissionSyncResult.updated,
        permissionSyncRemoved: permissionSyncResult.removed,
        permissionSyncUnchanged: permissionSyncResult.unchanged,
        importedUsersCreated: importedUsers.importedUserCount,
        importedUsersSkipped: importedUsers.skippedExistingUsers,
        createdRootRole: rootSyncState.createdRootRole,
        createdRootPermission: rootSyncState.createdRootPermission,
        assignedRootPermissionToRootRole:
          rootSyncState.assignedRootPermissionToRootRole,
        rootPermissionPurgedFromOtherRoles:
          rootSyncState.rootPermissionPurgedFromOtherRoles,
        rootHtshadowUpdated,
        rootUserCreated: rootUserSyncResult.rootUserCreated,
        rootUserUpdated: rootUserSyncResult.rootUserUpdated,
        rootRoleAssignedToRootUser:
          rootUserSyncResult.rootRoleAssignedToRootUser,
        createdSystemRoles: systemRoleSyncResult.createdSystemRoles,
        updatedSystemRoles: systemRoleSyncResult.updatedSystemRoles,
        reconciledSystemRolePermissionSets:
          systemRoleSyncResult.reconciledSystemRolePermissionSets,
        totalRoles: totalRolesCount,
        runId,
      },
    );
  } catch (error) {
    logStartupPhaseFailed(topLevelContext, Date.now() - runStartMs, error, {
      rootUsername,
    });
    throw error;
  }
};
