import { readFile, rename, writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import {
  type PermissionRepository,
  type RolePermissionRepository,
  type RoleRepository,
  type UserRepository,
  type UserRoleRepository,
} from "#/application/ports/rbac";

const ROOT_ROLE_NAME = "Root";
const ROOT_PERMISSION = {
  resource: "root",
  action: "access",
  isRoot: true,
} as const;
const BCRYPT_SALT_ROUNDS = 10;

const normalizeUsername = (value: string): string => value.trim().toLowerCase();

const deriveUserName = (username: string): string => {
  const trimmed = username.trim();
  if (!trimmed) {
    return "User";
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
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
  } else if (
    rootPermission.isRoot !== true &&
    deps.permissionRepository.updateIsRoot
  ) {
    await deps.permissionRepository.updateIsRoot(rootPermission.id, true);
    rootPermission = { ...rootPermission, isRoot: true };
  }

  const rolePermissionAssignments =
    await deps.rolePermissionRepository.listPermissionsByRoleId(rootRole.id);
  const permissionIds = rolePermissionAssignments.map(
    (assignment) => assignment.permissionId,
  );
  if (!permissionIds.includes(rootPermission.id)) {
    await deps.rolePermissionRepository.setRolePermissions(rootRole.id, [
      ...new Set([...permissionIds, rootPermission.id]),
    ]);
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
  if (!roleIds.includes(deps.rootRoleId)) {
    await deps.userRoleRepository.setUserRoles(rootUser.id, [
      ...new Set([...roleIds, deps.rootRoleId]),
    ]);
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
