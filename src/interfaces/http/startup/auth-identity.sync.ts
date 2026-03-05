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

const ROOT_ROLE_NAME = "Root";
const BCRYPT_SALT_ROUNDS = 10;

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

const ensureCanonicalStandardPermissions = async (deps: {
  permissionRepository: PermissionRepository;
}): Promise<void> => {
  const rootPermissionKey = canonicalPermissionKey(ROOT_PERMISSION);
  const existing = await deps.permissionRepository.list();
  const existingByKey = new Map(
    existing.map((permission) => [
      canonicalPermissionKey(permission),
      permission,
    ]),
  );
  const canonicalKeys = new Set(
    CANONICAL_STANDARD_RESOURCE_ACTIONS.map((permission) =>
      canonicalPermissionKey(permission),
    ),
  );

  for (const permission of CANONICAL_STANDARD_RESOURCE_ACTIONS) {
    const key = canonicalPermissionKey(permission);
    const existingPermission = existingByKey.get(key);
    if (!existingPermission) {
      await deps.permissionRepository.create(permission);
      continue;
    }
    if (
      existingPermission.isRoot === true &&
      deps.permissionRepository.updateIsRoot
    ) {
      await deps.permissionRepository.updateIsRoot(
        existingPermission.id,
        false,
      );
    } else if (
      existingPermission.isRoot === true &&
      !deps.permissionRepository.updateIsRoot
    ) {
      throw new Error(
        "permissionRepository.updateIsRoot is required for strict permission normalization",
      );
    }
  }

  const stalePermissionIds = existing
    .filter((permission) => {
      const key = canonicalPermissionKey(permission);
      if (key === rootPermissionKey) {
        return false;
      }
      return !canonicalKeys.has(key);
    })
    .map((permission) => permission.id);

  if (stalePermissionIds.length === 0) {
    return;
  }

  if (!deps.permissionRepository.deleteByIds) {
    throw new Error(
      "permissionRepository.deleteByIds is required for strict permission normalization",
    );
  }
  await deps.permissionRepository.deleteByIds(stalePermissionIds);
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
}): Promise<{ rootRoleId: string; rootPermissionId: string }> => {
  const roles = await deps.roleRepository.list();
  let rootRole = roles.find((role) => role.name === ROOT_ROLE_NAME) ?? null;
  if (!rootRole) {
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

  return { rootRoleId: rootRole.id, rootPermissionId: rootPermission.id };
};

const ensureRootUser = async (deps: {
  userRepository: UserRepository;
  userRoleRepository: UserRoleRepository;
  rootRoleId: string;
  rootUsername: string;
  rootEmail: string | null;
}): Promise<void> => {
  const expectedName = deriveUserName(deps.rootUsername);
  let rootUser = await deps.userRepository.findByUsername(deps.rootUsername);

  if (!rootUser) {
    rootUser = await deps.userRepository.create({
      username: deps.rootUsername,
      email: deps.rootEmail,
      name: expectedName,
      isActive: true,
    });
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
    }
  }

  const currentAssignments = await deps.userRoleRepository.listRolesByUserId(
    rootUser.id,
  );
  const roleIds = currentAssignments.map((assignment) => assignment.roleId);
  const hasExactRootRoleOnly =
    roleIds.length === 1 && roleIds[0] === deps.rootRoleId;
  if (!hasExactRootRoleOnly) {
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
};

const importHtshadowUsers = async (deps: {
  userRepository: UserRepository;
  usernames: readonly string[];
  rootUsername: string;
}): Promise<void> => {
  for (const username of deps.usernames) {
    if (username === deps.rootUsername) {
      continue;
    }
    const existing = await deps.userRepository.findByUsername(username);
    if (existing) {
      continue;
    }
    await deps.userRepository.create({
      username,
      email: null,
      name: deriveUserName(username),
      isActive: true,
    });
  }
};

const ensureRootHtshadowEntry = async (input: {
  htshadowPath: string;
  rootUsername: string;
  rootPassword: string;
  map: Map<string, string>;
}): Promise<void> => {
  const currentHash = input.map.get(input.rootUsername);
  const isCurrentValid =
    currentHash != null
      ? await bcrypt.compare(input.rootPassword, currentHash)
      : false;
  if (isCurrentValid) {
    return;
  }
  const nextHash = await bcrypt.hash(input.rootPassword, BCRYPT_SALT_ROUNDS);
  input.map.set(input.rootUsername, nextHash);
  await writeHtshadowMap(input.htshadowPath, input.map);
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

  const htshadowMap = await readHtshadowMap(deps.htshadowPath);
  await ensureRootHtshadowEntry({
    htshadowPath: deps.htshadowPath,
    rootUsername,
    rootPassword,
    map: htshadowMap,
  });

  await ensureCanonicalStandardPermissions({
    permissionRepository: deps.repositories.permissionRepository,
  });

  const rolePermissionState = await ensureRootRoleAndPermission({
    roleRepository: deps.repositories.roleRepository,
    permissionRepository: deps.repositories.permissionRepository,
    rolePermissionRepository: deps.repositories.rolePermissionRepository,
  });

  await ensureRootUser({
    userRepository: deps.repositories.userRepository,
    userRoleRepository: deps.repositories.userRoleRepository,
    rootRoleId: rolePermissionState.rootRoleId,
    rootUsername,
    rootEmail,
  });

  await importHtshadowUsers({
    userRepository: deps.repositories.userRepository,
    usernames: [...htshadowMap.keys()],
    rootUsername,
  });
};
