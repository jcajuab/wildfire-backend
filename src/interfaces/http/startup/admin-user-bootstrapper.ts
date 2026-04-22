import {
  type CredentialsRepository,
  type PasswordHasher,
} from "#/application/ports/auth";
import {
  type UserRepository,
  type UserRoleRepository,
} from "#/application/ports/rbac";
import { db } from "#/infrastructure/db/client";

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

export interface AdminUserSyncMetrics {
  adminUserCreated: boolean;
  adminUserUpdated: boolean;
  adminRoleAssignedToAdminUser: boolean;
}

/**
 * Phase 1: Find-or-create admin user.
 * - Finds admin by role (not username). If found, skips creation (env vars ignored).
 * - If no admin found, creates from env vars and stores password hash in DB.
 * Phase 2: Purge admin role from unauthorized users (runs on EVERY boot).
 */
export const ensureAdminUser = async (deps: {
  userRepository: UserRepository;
  userRoleRepository: UserRoleRepository;
  adminRoleId: string;
  adminUsername: string;
  adminEmail: string | null;
  adminPassword: string;
  dbCredentialsRepository: CredentialsRepository;
  passwordHasher: PasswordHasher;
}): Promise<AdminUserSyncMetrics> => {
  return db.transaction(async () => {
    const result: AdminUserSyncMetrics = {
      adminUserCreated: false,
      adminUserUpdated: false,
      adminRoleAssignedToAdminUser: false,
    };

    // Phase 1: Find admin by role, or create on first boot
    const adminUserIds = await deps.userRoleRepository.listUserIdsByRoleId(
      deps.adminRoleId,
    );
    const firstAdminUserId = adminUserIds[0];
    let adminUser = firstAdminUserId
      ? await deps.userRepository.findById(firstAdminUserId)
      : null;

    if (!adminUser) {
      // First boot: create admin from env vars
      const expectedName = deriveUserName(deps.adminUsername);
      adminUser = await deps.userRepository.create({
        username: deps.adminUsername,
        email: deps.adminEmail,
        name: expectedName,
        isActive: true,
      });
      result.adminUserCreated = true;

      // Assign admin role
      await deps.userRoleRepository.setUserRoles(adminUser.id, [
        deps.adminRoleId,
      ]);
      result.adminRoleAssignedToAdminUser = true;

      // Create DB credential
      const passwordHash = await deps.passwordHasher.hash(deps.adminPassword);
      await deps.dbCredentialsRepository.createPasswordHash(
        adminUser.username,
        passwordHash,
      );
    }
    // If admin found by role: skip creation, do NOT update from env vars

    // Phase 2: Purge admin role from unauthorized users (ALWAYS runs)
    const users = await deps.userRepository.list();
    for (const user of users) {
      if (user.id === adminUser.id) {
        continue;
      }
      const assignments = await deps.userRoleRepository.listRolesByUserId(
        user.id,
      );
      const userRoleIds = assignments.map((assignment) => assignment.roleId);
      if (!userRoleIds.includes(deps.adminRoleId)) {
        continue;
      }
      const nextRoleIds = uniqueIds(
        userRoleIds.filter((roleId) => roleId !== deps.adminRoleId),
      );
      await deps.userRoleRepository.setUserRoles(user.id, nextRoleIds);
    }

    return result;
  });
};
