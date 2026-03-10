import { type UserRepository } from "#/application/ports/rbac";

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
}

/**
 * Imports users from htshadow file into the user directory.
 * Skips root user and users that already exist.
 */
export const importHtshadowUsers = async (deps: {
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
