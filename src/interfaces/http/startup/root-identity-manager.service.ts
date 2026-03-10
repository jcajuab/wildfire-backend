import bcrypt from "bcryptjs";
import {
  type PermissionRepository,
  type RolePermissionRepository,
  type RoleRepository,
  type UserRepository,
  type UserRoleRepository,
} from "#/application/ports/rbac";
import { ROOT_PERMISSION } from "#/domain/rbac/canonical-permissions";
import { db } from "#/infrastructure/db/client";
import { writeHtshadowMap } from "./htshadow-file.adapter";

const ROOT_ROLE_NAME = "Root";
const BCRYPT_SALT_ROUNDS = 10;

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

const deriveUserName = (username: string): string => {
  const trimmed = username.trim();
  if (!trimmed) {
    return "User";
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
};

export interface RootRolePermissionSyncMetrics {
  createdRootRole: boolean;
  createdRootPermission: boolean;
  assignedRootPermissionToRootRole: boolean;
  rootPermissionPurgedFromOtherRoles: number;
}

export interface RootUserSyncMetrics {
  rootUserCreated: boolean;
  rootUserUpdated: boolean;
  rootRoleAssignedToRootUser: boolean;
}

/**
 * Ensures Root role exists, Root permission exists, and they are properly associated.
 * Also purges root permission from all other roles for security.
 */
export const ensureRootRoleAndPermission = async (deps: {
  roleRepository: RoleRepository;
  permissionRepository: PermissionRepository;
  rolePermissionRepository: RolePermissionRepository;
}): Promise<
  RootRolePermissionSyncMetrics & {
    rootRoleId: string;
    rootPermissionId: string;
  }
> => {
  return db.transaction(async () => {
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
  });
};

/**
 * Ensures root user exists in the directory with correct email/name.
 * Assigns Root role exclusively to root user and purges it from all other users.
 */
export const ensureRootUser = async (deps: {
  userRepository: UserRepository;
  userRoleRepository: UserRoleRepository;
  rootRoleId: string;
  rootUsername: string;
  rootEmail: string | null;
}): Promise<RootUserSyncMetrics> => {
  return db.transaction(async () => {
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
      await deps.userRoleRepository.setUserRoles(rootUser.id, [
        deps.rootRoleId,
      ]);
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
  });
};

/**
 * Ensures root user's htshadow entry has the correct password hash.
 * Returns true if the hash was updated, false if already correct.
 */
export const ensureRootHtshadowEntry = async (input: {
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
