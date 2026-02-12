import { type Hono, type MiddlewareHandler } from "hono";
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
  CreateRoleUseCase,
  CreateUserUseCase,
  DeleteRoleUseCase,
  DeleteUserUseCase,
  GetRolePermissionsUseCase,
  GetRoleUseCase,
  GetRoleUsersUseCase,
  GetUserRolesUseCase,
  GetUserUseCase,
  ListPermissionsUseCase,
  ListRolesUseCase,
  ListUsersUseCase,
  SetRolePermissionsUseCase,
  SetUserRolesUseCase,
  UpdateRoleUseCase,
  UpdateUserUseCase,
} from "#/application/use-cases/rbac";
import { addAvatarUrlToUser } from "#/interfaces/http/lib/avatar-url";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";

export interface RbacRouterDeps {
  jwtSecret: string;
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

export const createRbacUseCases = (
  deps: RbacRouterDeps,
): RbacRouterUseCases => ({
  listRoles: new ListRolesUseCase({
    roleRepository: deps.repositories.roleRepository,
    userRoleRepository: deps.repositories.userRoleRepository,
  }),
  createRole: new CreateRoleUseCase({
    roleRepository: deps.repositories.roleRepository,
  }),
  getRole: new GetRoleUseCase({
    roleRepository: deps.repositories.roleRepository,
  }),
  updateRole: new UpdateRoleUseCase({
    roleRepository: deps.repositories.roleRepository,
  }),
  deleteRole: new DeleteRoleUseCase({
    roleRepository: deps.repositories.roleRepository,
  }),
  getRolePermissions: new GetRolePermissionsUseCase({
    roleRepository: deps.repositories.roleRepository,
    rolePermissionRepository: deps.repositories.rolePermissionRepository,
    permissionRepository: deps.repositories.permissionRepository,
  }),
  setRolePermissions: new SetRolePermissionsUseCase({
    roleRepository: deps.repositories.roleRepository,
    rolePermissionRepository: deps.repositories.rolePermissionRepository,
    permissionRepository: deps.repositories.permissionRepository,
  }),
  listPermissions: new ListPermissionsUseCase({
    permissionRepository: deps.repositories.permissionRepository,
  }),
  listUsers: new ListUsersUseCase({
    userRepository: deps.repositories.userRepository,
  }),
  createUser: new CreateUserUseCase({
    userRepository: deps.repositories.userRepository,
  }),
  getUser: new GetUserUseCase({
    userRepository: deps.repositories.userRepository,
  }),
  updateUser: new UpdateUserUseCase({
    userRepository: deps.repositories.userRepository,
    userRoleRepository: deps.repositories.userRoleRepository,
    roleRepository: deps.repositories.roleRepository,
  }),
  deleteUser: new DeleteUserUseCase({
    userRepository: deps.repositories.userRepository,
    userRoleRepository: deps.repositories.userRoleRepository,
    roleRepository: deps.repositories.roleRepository,
  }),
  setUserRoles: new SetUserRolesUseCase({
    userRepository: deps.repositories.userRepository,
    roleRepository: deps.repositories.roleRepository,
    userRoleRepository: deps.repositories.userRoleRepository,
  }),
  getUserRoles: new GetUserRolesUseCase({
    userRepository: deps.repositories.userRepository,
    userRoleRepository: deps.repositories.userRoleRepository,
    roleRepository: deps.repositories.roleRepository,
  }),
  getRoleUsers: new GetRoleUsersUseCase({
    roleRepository: deps.repositories.roleRepository,
    userRoleRepository: deps.repositories.userRoleRepository,
    userRepository: deps.repositories.userRepository,
  }),
});

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
