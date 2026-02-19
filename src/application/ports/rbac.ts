import { type Permission } from "#/domain/rbac/permission";

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  timezone?: string | null;
  avatarKey?: string | null;
  lastSeenAt?: string | null;
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

export type PolicyHistoryChangeType = "role_permissions" | "user_roles";
export type PolicyHistoryTargetType = "role" | "user";

export type RoleDeletionRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

export interface PolicyHistoryRecord {
  id: string;
  occurredAt: string;
  policyVersion: number;
  changeType: PolicyHistoryChangeType;
  targetId: string;
  targetType: PolicyHistoryTargetType;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  requestId: string | null;
  targetCount: number;
  addedCount: number;
  removedCount: number;
}

export interface RoleDeletionRequestRecord {
  id: string;
  roleId: string;
  roleName: string;
  requestedByUserId: string;
  requestedByName: string;
  requestedByEmail: string;
  requestedAt: string;
  status: RoleDeletionRequestStatus;
  approvedByUserId: string | null;
  approvedByName: string | null;
  approvedByEmail: string | null;
  approvedAt: string | null;
  reason: string | null;
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
    input: {
      email?: string;
      name?: string;
      isActive?: boolean;
      timezone?: string | null;
      avatarKey?: string | null;
      lastSeenAt?: string | null;
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

export interface PolicyHistoryRepository {
  create(input: {
    policyVersion: number;
    changeType: PolicyHistoryChangeType;
    targetId: string;
    targetType: PolicyHistoryTargetType;
    actorId?: string;
    requestId?: string;
    targetCount: number;
    addedCount: number;
    removedCount: number;
  }): Promise<void>;
  list(input: {
    offset: number;
    limit: number;
    policyVersion?: number;
    changeType?: PolicyHistoryChangeType;
    targetId?: string;
    actorId?: string;
    from?: string;
    to?: string;
  }): Promise<PolicyHistoryRecord[]>;
  count(input: {
    policyVersion?: number;
    changeType?: PolicyHistoryChangeType;
    targetId?: string;
    actorId?: string;
    from?: string;
    to?: string;
  }): Promise<number>;
}

export interface RoleDeletionRequestRepository {
  createPending(input: {
    roleId: string;
    requestedByUserId: string;
    reason?: string;
  }): Promise<void>;
  findPendingByRoleId(
    roleId: string,
  ): Promise<RoleDeletionRequestRecord | null>;
  findById(id: string): Promise<RoleDeletionRequestRecord | null>;
  list(input: {
    offset: number;
    limit: number;
    status?: RoleDeletionRequestStatus;
    roleId?: string;
  }): Promise<RoleDeletionRequestRecord[]>;
  count(input: {
    status?: RoleDeletionRequestStatus;
    roleId?: string;
  }): Promise<number>;
  markApproved(input: {
    id: string;
    approvedByUserId: string;
  }): Promise<boolean>;
  markRejected(input: {
    id: string;
    approvedByUserId: string;
    reason?: string;
  }): Promise<boolean>;
}

export interface AuthorizationRepository {
  findPermissionsForUser(userId: string): Promise<Permission[]>;
}
