import { type ContentStorage } from "#/application/ports/content";
import {
  type RoleRepository,
  type UserRoleRepository,
} from "#/application/ports/rbac";
import {
  addAvatarUrlsToUsers,
  addAvatarUrlToUser,
} from "#/interfaces/http/lib/avatar-url";

export interface UserResponseEnrichmentDeps {
  avatarStorage?: ContentStorage;
  avatarUrlExpiresInSeconds?: number;
  repositories: {
    userRoleRepository: UserRoleRepository;
    roleRepository: RoleRepository;
  };
}

export const removeAvatarKey = <T extends { avatarKey?: string | null }>(
  user: T,
): Omit<T, "avatarKey"> => {
  const { avatarKey: _k, ...rest } = user;
  return rest;
};

export const maybeEnrichUserForResponse = async <
  T extends { avatarKey?: string | null },
>(
  user: T,
  deps: UserResponseEnrichmentDeps,
): Promise<Omit<T, "avatarKey"> & { avatarUrl?: string }> => {
  const storage = deps.avatarStorage;
  const expiresIn = deps.avatarUrlExpiresInSeconds;

  if (storage != null && expiresIn != null && expiresIn > 0) {
    return addAvatarUrlToUser(user, storage, expiresIn);
  }

  return removeAvatarKey(user);
};

export const maybeEnrichUsersForResponse = async <
  T extends { avatarKey?: string | null },
>(
  users: T[],
  deps: UserResponseEnrichmentDeps,
): Promise<Array<Omit<T, "avatarKey"> & { avatarUrl?: string }>> => {
  const storage = deps.avatarStorage;
  const expiresIn = deps.avatarUrlExpiresInSeconds;

  if (storage != null && expiresIn != null && expiresIn > 0) {
    return addAvatarUrlsToUsers(users, storage, expiresIn);
  }

  return users.map(removeAvatarKey);
};

export const addRoleSummariesToUsers = async <
  T extends { id: string; avatarKey?: string | null },
>(
  users: T[],
  deps: UserResponseEnrichmentDeps,
): Promise<
  Array<
    Omit<T, "avatarKey"> & {
      avatarUrl?: string;
      roles: Array<{ id: string; name: string }>;
    }
  >
> => {
  const assignments =
    deps.repositories.userRoleRepository.listRolesByUserIds != null
      ? await deps.repositories.userRoleRepository.listRolesByUserIds(
          users.map((user) => user.id),
        )
      : (
          await Promise.all(
            users.map((user) =>
              deps.repositories.userRoleRepository.listRolesByUserId(user.id),
            ),
          )
        ).flat();

  const [enrichedUsers] = await Promise.all([
    maybeEnrichUsersForResponse(users, deps),
  ]);

  const roleIds = [
    ...new Set(assignments.map((assignment) => assignment.roleId)),
  ];
  const roles = await deps.repositories.roleRepository.findByIds(roleIds);
  const rolesById = new Map(roles.map((role) => [role.id, role.name]));
  const roleIdsByUser = new Map<string, string[]>();
  for (const assignment of assignments) {
    const existing = roleIdsByUser.get(assignment.userId) ?? [];
    existing.push(assignment.roleId);
    roleIdsByUser.set(assignment.userId, existing);
  }

  return enrichedUsers.map((user) => ({
    ...user,
    roles: (roleIdsByUser.get(user.id) ?? []).flatMap((roleId) => {
      const roleName = rolesById.get(roleId);
      return roleName ? [{ id: roleId, name: roleName }] : [];
    }),
  }));
};
