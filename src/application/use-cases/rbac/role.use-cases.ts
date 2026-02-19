import { ForbiddenError } from "#/application/errors/forbidden";
import {
  type PermissionRepository,
  type PolicyHistoryRepository,
  type RoleDeletionRequestRepository,
  type RolePermissionRepository,
  type RoleRepository,
  type RoleWithUserCount,
  type UserRepository,
  type UserRoleRepository,
} from "#/application/ports/rbac";
import { NotFoundError } from "#/application/use-cases/rbac/errors";
import {
  type PaginatedResult,
  paginate,
} from "#/application/use-cases/shared/pagination";

export class ListRolesUseCase {
  constructor(
    private readonly deps: {
      roleRepository: RoleRepository;
      userRoleRepository: UserRoleRepository;
    },
  ) {}

  async execute(input?: {
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResult<RoleWithUserCount>> {
    const roles = await this.deps.roleRepository.list();
    const roleIds = roles.map((r) => r.id);
    const counts =
      await this.deps.userRoleRepository.listUserCountByRoleIds(roleIds);
    const enriched = roles.map((r) => ({
      ...r,
      usersCount: counts[r.id] ?? 0,
    }));
    return paginate(enriched, input);
  }
}

export class CreateRoleUseCase {
  constructor(private readonly deps: { roleRepository: RoleRepository }) {}

  execute(input: { name: string; description?: string | null }) {
    return this.deps.roleRepository.create({
      name: input.name,
      description: input.description ?? null,
    });
  }
}

export class GetRoleUseCase {
  constructor(private readonly deps: { roleRepository: RoleRepository }) {}

  async execute(input: { id: string }) {
    const role = await this.deps.roleRepository.findById(input.id);
    if (!role) throw new NotFoundError("Role not found");
    return role;
  }
}

export class UpdateRoleUseCase {
  constructor(private readonly deps: { roleRepository: RoleRepository }) {}

  async execute(input: {
    id: string;
    name?: string;
    description?: string | null;
  }) {
    const existing = await this.deps.roleRepository.findById(input.id);
    if (!existing) throw new NotFoundError("Role not found");
    if (existing.isSystem) {
      throw new ForbiddenError("Cannot modify system role");
    }
    const role = await this.deps.roleRepository.update(input.id, {
      name: input.name,
      description: input.description,
    });
    if (!role) throw new NotFoundError("Role not found");
    return role;
  }
}

export class DeleteRoleUseCase {
  constructor(
    private readonly deps: {
      roleRepository: RoleRepository;
      userRoleRepository: UserRoleRepository;
    },
  ) {}

  async execute(input: { id: string; callerUserId?: string }) {
    const role = await this.deps.roleRepository.findById(input.id);
    if (!role) throw new NotFoundError("Role not found");
    if (role.isSystem) {
      throw new ForbiddenError("Cannot delete system role");
    }
    const callerIsSuperAdmin = await isUserSuperAdmin({
      roleRepository: this.deps.roleRepository,
      userRoleRepository: this.deps.userRoleRepository,
      userId: input.callerUserId,
    });
    if (!callerIsSuperAdmin) {
      throw new ForbiddenError(
        "Only Super Admin can delete roles directly. Submit a deletion request.",
      );
    }
    const deleted = await this.deps.roleRepository.delete(input.id);
    if (!deleted) throw new NotFoundError("Role not found");
  }
}

const isUserSuperAdmin = async (input: {
  roleRepository: RoleRepository;
  userRoleRepository: UserRoleRepository;
  userId?: string;
}): Promise<boolean> => {
  if (!input.userId) return false;
  const roles = await input.roleRepository.list();
  const systemRole = roles.find((role) => role.isSystem);
  if (!systemRole) return false;
  const assignments = await input.userRoleRepository.listRolesByUserId(
    input.userId,
  );
  return assignments.some((assignment) => assignment.roleId === systemRole.id);
};

export class CreateRoleDeletionRequestUseCase {
  constructor(
    private readonly deps: {
      roleRepository: RoleRepository;
      userRoleRepository: UserRoleRepository;
      roleDeletionRequestRepository: RoleDeletionRequestRepository;
    },
  ) {}

  async execute(input: {
    roleId: string;
    requestedByUserId: string;
    reason?: string;
  }): Promise<void> {
    const role = await this.deps.roleRepository.findById(input.roleId);
    if (!role) throw new NotFoundError("Role not found");
    if (role.isSystem) {
      throw new ForbiddenError("Cannot request deletion for system role");
    }

    const requesterIsSuperAdmin = await isUserSuperAdmin({
      roleRepository: this.deps.roleRepository,
      userRoleRepository: this.deps.userRoleRepository,
      userId: input.requestedByUserId,
    });
    if (requesterIsSuperAdmin) {
      throw new ForbiddenError(
        "Super Admin can delete roles directly without a request.",
      );
    }

    const pending =
      await this.deps.roleDeletionRequestRepository.findPendingByRoleId(
        input.roleId,
      );
    if (pending) {
      throw new ForbiddenError("A pending deletion request already exists.");
    }

    await this.deps.roleDeletionRequestRepository.createPending({
      roleId: input.roleId,
      requestedByUserId: input.requestedByUserId,
      reason: input.reason,
    });
  }
}

export class ListRoleDeletionRequestsUseCase {
  constructor(
    private readonly deps: {
      roleDeletionRequestRepository: RoleDeletionRequestRepository;
    },
  ) {}

  async execute(input?: {
    page?: number;
    pageSize?: number;
    status?: "pending" | "approved" | "rejected" | "cancelled";
    roleId?: string;
  }) {
    const page = Math.max(1, input?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, input?.pageSize ?? 20));
    const offset = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.deps.roleDeletionRequestRepository.list({
        offset,
        limit: pageSize,
        status: input?.status,
        roleId: input?.roleId,
      }),
      this.deps.roleDeletionRequestRepository.count({
        status: input?.status,
        roleId: input?.roleId,
      }),
    ]);

    return {
      items,
      page,
      pageSize,
      total,
    };
  }
}

export class ApproveRoleDeletionRequestUseCase {
  constructor(
    private readonly deps: {
      roleRepository: RoleRepository;
      userRoleRepository: UserRoleRepository;
      roleDeletionRequestRepository: RoleDeletionRequestRepository;
    },
  ) {}

  async execute(input: { requestId: string; approvedByUserId: string }) {
    const approverIsSuperAdmin = await isUserSuperAdmin({
      roleRepository: this.deps.roleRepository,
      userRoleRepository: this.deps.userRoleRepository,
      userId: input.approvedByUserId,
    });
    if (!approverIsSuperAdmin) {
      throw new ForbiddenError("Only Super Admin can approve role deletion.");
    }

    const request = await this.deps.roleDeletionRequestRepository.findById(
      input.requestId,
    );
    if (!request) throw new NotFoundError("Deletion request not found");
    if (request.status !== "pending") {
      throw new ForbiddenError("Deletion request is no longer pending.");
    }

    const role = await this.deps.roleRepository.findById(request.roleId);
    if (!role) throw new NotFoundError("Role not found");
    if (role.isSystem) {
      throw new ForbiddenError("Cannot delete system role");
    }

    const deleted = await this.deps.roleRepository.delete(request.roleId);
    if (!deleted) throw new NotFoundError("Role not found");

    const marked = await this.deps.roleDeletionRequestRepository.markApproved({
      id: request.id,
      approvedByUserId: input.approvedByUserId,
    });
    if (!marked) {
      throw new ForbiddenError("Deletion request is no longer pending.");
    }
  }
}

export class RejectRoleDeletionRequestUseCase {
  constructor(
    private readonly deps: {
      roleRepository: RoleRepository;
      userRoleRepository: UserRoleRepository;
      roleDeletionRequestRepository: RoleDeletionRequestRepository;
    },
  ) {}

  async execute(input: {
    requestId: string;
    approvedByUserId: string;
    reason?: string;
  }) {
    const approverIsSuperAdmin = await isUserSuperAdmin({
      roleRepository: this.deps.roleRepository,
      userRoleRepository: this.deps.userRoleRepository,
      userId: input.approvedByUserId,
    });
    if (!approverIsSuperAdmin) {
      throw new ForbiddenError("Only Super Admin can reject role deletion.");
    }

    const request = await this.deps.roleDeletionRequestRepository.findById(
      input.requestId,
    );
    if (!request) throw new NotFoundError("Deletion request not found");
    if (request.status !== "pending") {
      throw new ForbiddenError("Deletion request is no longer pending.");
    }

    const marked = await this.deps.roleDeletionRequestRepository.markRejected({
      id: request.id,
      approvedByUserId: input.approvedByUserId,
      reason: input.reason,
    });
    if (!marked) {
      throw new ForbiddenError("Deletion request is no longer pending.");
    }
  }
}

export class GetRolePermissionsUseCase {
  constructor(
    private readonly deps: {
      roleRepository: RoleRepository;
      rolePermissionRepository: RolePermissionRepository;
      permissionRepository: PermissionRepository;
    },
  ) {}

  async execute(input: { roleId: string; page?: number; pageSize?: number }) {
    const role = await this.deps.roleRepository.findById(input.roleId);
    if (!role) throw new NotFoundError("Role not found");

    const rolePermissions =
      await this.deps.rolePermissionRepository.listPermissionsByRoleId(
        input.roleId,
      );
    const permissionIds = rolePermissions.map((item) => item.permissionId);
    const permissions =
      await this.deps.permissionRepository.findByIds(permissionIds);
    return paginate(permissions, {
      page: input.page,
      pageSize: input.pageSize,
    });
  }
}

export class SetRolePermissionsUseCase {
  constructor(
    private readonly deps: {
      roleRepository: RoleRepository;
      rolePermissionRepository: RolePermissionRepository;
      permissionRepository: PermissionRepository;
      policyHistoryRepository: PolicyHistoryRepository;
    },
  ) {}

  async execute(input: {
    roleId: string;
    permissionIds: string[];
    policyVersion?: number;
    actorId?: string;
    requestId?: string;
  }) {
    const role = await this.deps.roleRepository.findById(input.roleId);
    if (!role) throw new NotFoundError("Role not found");
    if (role.isSystem) {
      throw new ForbiddenError("Cannot modify permissions of system role");
    }

    const currentAssignments =
      await this.deps.rolePermissionRepository.listPermissionsByRoleId(
        input.roleId,
      );
    const currentPermissionIds = new Set(
      currentAssignments.map((item) => item.permissionId),
    );
    const nextPermissionIds = new Set(input.permissionIds);
    const addedCount = [...nextPermissionIds].filter(
      (permissionId) => !currentPermissionIds.has(permissionId),
    ).length;
    const removedCount = [...currentPermissionIds].filter(
      (permissionId) => !nextPermissionIds.has(permissionId),
    ).length;

    await this.deps.rolePermissionRepository.setRolePermissions(
      input.roleId,
      input.permissionIds,
    );

    if (input.policyVersion !== undefined) {
      await this.deps.policyHistoryRepository.create({
        policyVersion: input.policyVersion,
        changeType: "role_permissions",
        targetId: input.roleId,
        targetType: "role",
        actorId: input.actorId,
        requestId: input.requestId,
        targetCount: nextPermissionIds.size,
        addedCount,
        removedCount,
      });
    }

    return this.deps.permissionRepository.findByIds(input.permissionIds);
  }
}

export class GetRoleUsersUseCase {
  constructor(
    private readonly deps: {
      roleRepository: RoleRepository;
      userRoleRepository: UserRoleRepository;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input: { roleId: string; page?: number; pageSize?: number }) {
    const role = await this.deps.roleRepository.findById(input.roleId);
    if (!role) throw new NotFoundError("Role not found");

    const userIds = await this.deps.userRoleRepository.listUserIdsByRoleId(
      input.roleId,
    );
    if (userIds.length === 0) {
      return paginate([], {
        page: input.page,
        pageSize: input.pageSize,
      });
    }

    const users = await this.deps.userRepository.findByIds(userIds);
    return paginate(users, {
      page: input.page,
      pageSize: input.pageSize,
    });
  }
}
