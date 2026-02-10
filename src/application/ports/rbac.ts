import { type Permission } from "#/domain/rbac/permission";

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
}

export interface RoleRecord {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
}

export interface RoleWithUserCount extends RoleRecord {
  usersCount: number;
}

export interface PermissionRecord {
  id: string;
  resource: string;
  action: string;
}

export interface UserRepository {
  list(): Promise<UserRecord[]>;
  findById(id: string): Promise<UserRecord | null>;
  findByIds(ids: string[]): Promise<UserRecord[]>;
  findByEmail(email: string): Promise<UserRecord | null>;
  create(input: {
    email: string;
    name: string;
    isActive?: boolean;
  }): Promise<UserRecord>;
  update(
    id: string,
    input: { email?: string; name?: string; isActive?: boolean },
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
    isSystem?: boolean;
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
  }): Promise<PermissionRecord>;
}

export interface UserRoleRepository {
  listRolesByUserId(
    userId: string,
  ): Promise<{ userId: string; roleId: string }[]>;
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
}
