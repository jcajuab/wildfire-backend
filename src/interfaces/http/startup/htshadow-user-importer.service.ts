import {
  type RoleRepository,
  type UserRepository,
  type UserRoleRepository,
} from "#/application/ports/rbac";

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
