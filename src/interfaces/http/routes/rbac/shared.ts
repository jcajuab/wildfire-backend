import { type Hono } from "hono";
import {
  type AuthSessionRepository,
  type CredentialsReader,
  type CredentialsRepository,
  type InvitationRepository,
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
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { type AuthorizePermission } from "#/interfaces/http/routes/shared/error-handling";

export interface RbacRouterDeps {
  jwtSecret: string;
  authSessionRepository: AuthSessionRepository;
  authSessionCookieName: string;
  /** Read-only htshadow credential lookup; same as auth router. */
  credentialsRepository: CredentialsReader;
  dbCredentialsRepository: CredentialsRepository;
  invitationRepository?: InvitationRepository;
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
