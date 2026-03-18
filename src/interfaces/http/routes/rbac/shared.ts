import { type Hono } from "hono";
import {
  type AuthSessionRepository,
  type CredentialsRepository,
  type PasswordHasher,
} from "#/application/ports/auth";
import { type ContentStorage } from "#/application/ports/content";
import {
  type AuthorizationRepository,
  type PermissionRepository,
  type RolePermissionRepository,
  type RoleRepository,
  type UserRepository,
  type UserRoleRepository,
} from "#/application/ports/rbac";
import {
  type CheckPermissionUseCase,
  type CreateRoleUseCase,
  type CreateUserUseCase,
  type DeleteRoleUseCase,
  type DeleteUserUseCase,
  type GetRolePermissionsUseCase,
  type GetRoleUseCase,
  type GetRoleUsersUseCase,
  type GetUserRolesUseCase,
  type GetUserUseCase,
  type ListPermissionOptionsUseCase,
  type ListPermissionsUseCase,
  type ListRoleOptionsUseCase,
  type ListRolesUseCase,
  type ListUserOptionsUseCase,
  type ListUsersUseCase,
  type SetRolePermissionsUseCase,
  type SetUserRolesUseCase,
  type UpdateRoleUseCase,
  type UpdateUserUseCase,
} from "#/application/use-cases/rbac";
import { type AdminResetPasswordUseCase } from "#/application/use-cases/users/admin-reset-password.use-case";
import {
  type BanUserUseCase,
  type UnbanUserUseCase,
} from "#/application/use-cases/users/ban-user.use-case";
import { addAvatarUrlToUser } from "#/interfaces/http/lib/avatar-url";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { type AuthorizePermission } from "#/interfaces/http/routes/shared/error-handling";

export interface RbacRouterDeps {
  jwtSecret: string;
  authSessionRepository: AuthSessionRepository;
  authSessionCookieName: string;
  credentialsRepository: CredentialsRepository;
  dbCredentialsRepository: CredentialsRepository;
  passwordHasher: PasswordHasher;
  repositories: {
    userRepository: UserRepository;
    roleRepository: RoleRepository;
    permissionRepository: PermissionRepository;
    userRoleRepository: UserRoleRepository;
    rolePermissionRepository: RolePermissionRepository;
    authorizationRepository: AuthorizationRepository;
  };
  avatarStorage?: ContentStorage;
  avatarUrlExpiresInSeconds?: number;
  checkPermissionUseCase: CheckPermissionUseCase;
}

export interface RbacRouterUseCases {
  listRoles: ListRolesUseCase;
  listRoleOptions: ListRoleOptionsUseCase;
  createRole: CreateRoleUseCase;
  getRole: GetRoleUseCase;
  updateRole: UpdateRoleUseCase;
  deleteRole: DeleteRoleUseCase;
  getRolePermissions: GetRolePermissionsUseCase;
  setRolePermissions: SetRolePermissionsUseCase;
  listPermissions: ListPermissionsUseCase;
  listPermissionOptions: ListPermissionOptionsUseCase;
  listUsers: ListUsersUseCase;
  listUserOptions: ListUserOptionsUseCase;
  createUser: CreateUserUseCase;
  getUser: GetUserUseCase;
  updateUser: UpdateUserUseCase;
  deleteUser: DeleteUserUseCase;
  setUserRoles: SetUserRolesUseCase;
  getUserRoles: GetUserRolesUseCase;
  getRoleUsers: GetRoleUsersUseCase;
  banUser: BanUserUseCase;
  unbanUser: UnbanUserUseCase;
  adminResetPassword: AdminResetPasswordUseCase;
}

export type RbacRouter = Hono<{ Variables: JwtUserVariables }>;

export type { AuthorizePermission };

export const roleTags = ["Roles"];
export const permissionTags = ["Permissions"];
export const userTags = ["Users"];

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
  deps: RbacRouterDeps,
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
  deps: RbacRouterDeps,
): Promise<Array<Omit<T, "avatarKey"> & { avatarUrl?: string }>> => {
  const storage = deps.avatarStorage;
  const expiresIn = deps.avatarUrlExpiresInSeconds;

  if (storage != null && expiresIn != null && expiresIn > 0) {
    return Promise.all(
      users.map((user) => addAvatarUrlToUser(user, storage, expiresIn)),
    );
  }

  return users.map(removeAvatarKey);
};

export const addRoleSummariesToUsers = async <
  T extends { id: string; avatarKey?: string | null },
>(
  users: T[],
  deps: RbacRouterDeps,
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
