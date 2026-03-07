import { type Hono, type MiddlewareHandler } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
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
  type ListPermissionsUseCase,
  type ListRolesUseCase,
  type ListUsersUseCase,
  type SetRolePermissionsUseCase,
  type SetUserRolesUseCase,
  type UpdateRoleUseCase,
  type UpdateUserUseCase,
} from "#/application/use-cases/rbac";
import { addAvatarUrlToUser } from "#/interfaces/http/lib/avatar-url";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";

export interface RbacRouterDeps {
  jwtSecret: string;
  authSessionRepository: AuthSessionRepository;
  authSessionCookieName: string;
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
  createRole: CreateRoleUseCase;
  getRole: GetRoleUseCase;
  updateRole: UpdateRoleUseCase;
  deleteRole: DeleteRoleUseCase;
  getRolePermissions: GetRolePermissionsUseCase;
  setRolePermissions: SetRolePermissionsUseCase;
  listPermissions: ListPermissionsUseCase;
  listUsers: ListUsersUseCase;
  createUser: CreateUserUseCase;
  getUser: GetUserUseCase;
  updateUser: UpdateUserUseCase;
  deleteUser: DeleteUserUseCase;
  setUserRoles: SetUserRolesUseCase;
  getUserRoles: GetUserRolesUseCase;
  getRoleUsers: GetRoleUsersUseCase;
}

export type RbacRouter = Hono<{ Variables: JwtUserVariables }>;

export type AuthorizePermission = (
  permission: string,
) => readonly [
  MiddlewareHandler,
  MiddlewareHandler<{ Variables: JwtUserVariables }>,
];

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
