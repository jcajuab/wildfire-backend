import { type Permission } from "#/domain/rbac/permission";

export interface UserRecord {
  id: string;
  username: string;
  email: string | null;
  name: string;
  isActive: boolean;
  timezone?: string | null;
  avatarKey?: string | null;
  lastSeenAt?: string | null;
  invitedAt?: string | null;
  bannedAt?: string | null;
}

export interface RoleRecord {
  id: string;
  name: string;
  description: string | null;
}

export interface RoleWithUserCount extends RoleRecord {
  usersCount: number;
}

export interface PermissionRecord {
  id: string;
  resource: string;
  action: string;
  isAdmin?: boolean;
}

export interface UserRepository {
  list(): Promise<UserRecord[]>;
  findById(id: string): Promise<UserRecord | null>;
  findByIds(ids: string[]): Promise<UserRecord[]>;
  findByUsername(username: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  create(input: {
    username: string;
    email?: string | null;
    name: string;
    isActive?: boolean;
    invitedAt?: Date | null;
  }): Promise<UserRecord>;
  update(
    id: string,
    input: {
      username?: string;
      email?: string | null;
      name?: string;
      isActive?: boolean;
      timezone?: string | null;
      avatarKey?: string | null;
      lastSeenAt?: string | null;
      bannedAt?: Date | null;
    },
  ): Promise<UserRecord | null>;
  delete(id: string): Promise<boolean>;
}

export interface RoleRepository {
  list(): Promise<RoleRecord[]>;
  findById(id: string): Promise<RoleRecord | null>;
  findByIds(ids: string[]): Promise<RoleRecord[]>;
  create(input: {
    name: string;
    description?: string | null;
  }): Promise<RoleRecord>;
  update(
    id: string,
    input: { name?: string; description?: string | null },
  ): Promise<RoleRecord | null>;
  delete(id: string): Promise<boolean>;
}

export interface PermissionRepository {
  list(): Promise<PermissionRecord[]>;
  findByIds(ids: string[]): Promise<PermissionRecord[]>;
  create(input: {
    resource: string;
    action: string;
    isAdmin?: boolean;
  }): Promise<PermissionRecord>;
  updateIsAdmin?: (id: string, isAdmin: boolean) => Promise<void>;
  deleteByIds?: (ids: string[]) => Promise<void>;
}

export interface UserRoleRepository {
  listRolesByUserId(
    userId: string,
  ): Promise<{ userId: string; roleId: string }[]>;
  listRolesByUserIds?(
    userIds: string[],
  ): Promise<Array<{ userId: string; roleId: string }>>;
  listUserIdsByRoleId(roleId: string): Promise<string[]>;
  listUserCountByRoleIds(roleIds: string[]): Promise<Record<string, number>>;
  setUserRoles(userId: string, roleIds: string[]): Promise<void>;
}

export interface RolePermissionRepository {
  listPermissionsByRoleId(
    roleId: string,
  ): Promise<{ roleId: string; permissionId: string }[]>;
  setRolePermissions(roleId: string, permissionIds: string[]): Promise<void>;
}

export interface AuthorizationRepository {
  findPermissionsForUser(userId: string): Promise<Permission[]>;
  isAdminUser(userId: string): Promise<boolean>;
}
