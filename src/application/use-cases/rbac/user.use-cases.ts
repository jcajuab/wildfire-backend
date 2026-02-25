import { ForbiddenError } from "#/application/errors/forbidden";
import {
  type AuthorizationRepository,
  type PermissionRepository,
  type PolicyHistoryRepository,
  type RolePermissionRepository,
  type RoleRepository,
  type UserRepository,
  type UserRoleRepository,
} from "#/application/ports/rbac";
import {
  DuplicateEmailError,
  NotFoundError,
} from "#/application/use-cases/rbac/errors";
import { paginate } from "#/application/use-cases/shared/pagination";

export class GetUserRolesUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      userRoleRepository: UserRoleRepository;
      roleRepository: RoleRepository;
    },
  ) {}

  async execute(input: { userId: string; page?: number; pageSize?: number }) {
    const user = await this.deps.userRepository.findById(input.userId);
    if (!user) throw new NotFoundError("User not found");

    const assignments = await this.deps.userRoleRepository.listRolesByUserId(
      input.userId,
    );
    const roleIds = assignments.map((a) => a.roleId);
    if (roleIds.length === 0) {
      return paginate([], {
        page: input.page,
        pageSize: input.pageSize,
      });
    }

    const roles = await this.deps.roleRepository.findByIds(roleIds);
    return paginate(roles, {
      page: input.page,
      pageSize: input.pageSize,
    });
  }
}

export class ListUsersUseCase {
  constructor(private readonly deps: { userRepository: UserRepository }) {}

  async execute(input?: { page?: number; pageSize?: number }) {
    const all = await this.deps.userRepository.list();
    return paginate(all, input);
  }
}

export class CreateUserUseCase {
  constructor(private readonly deps: { userRepository: UserRepository }) {}

  async execute(input: { email: string; name: string; isActive?: boolean }) {
    const existing = await this.deps.userRepository.findByEmail(input.email);
    if (existing) {
      throw new DuplicateEmailError();
    }
    return this.deps.userRepository.create({
      email: input.email,
      name: input.name,
      isActive: input.isActive,
    });
  }
}

export class GetUserUseCase {
  constructor(private readonly deps: { userRepository: UserRepository }) {}

  async execute(input: { id: string }) {
    const user = await this.deps.userRepository.findById(input.id);
    if (!user) throw new NotFoundError("User not found");
    return user;
  }
}

async function ensureCallerCanModifyRootUser(
  deps: {
    authorizationRepository: AuthorizationRepository;
  },
  targetUserId: string,
  callerUserId: string | undefined,
  forbiddenMessage: string,
): Promise<void> {
  const targetIsRoot = deps.authorizationRepository.isRootUser
    ? await deps.authorizationRepository.isRootUser(targetUserId)
    : false;
  if (!targetIsRoot) return;

  if (callerUserId === undefined) {
    throw new ForbiddenError(forbiddenMessage);
  }

  const callerIsRoot = deps.authorizationRepository.isRootUser
    ? await deps.authorizationRepository.isRootUser(callerUserId)
    : false;
  if (!callerIsRoot) {
    throw new ForbiddenError(forbiddenMessage);
  }
}

export class UpdateUserUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      authorizationRepository: AuthorizationRepository;
    },
  ) {}

  async execute(input: {
    id: string;
    email?: string;
    name?: string;
    isActive?: boolean;
    callerUserId?: string;
  }) {
    await ensureCallerCanModifyRootUser(
      this.deps,
      input.id,
      input.callerUserId,
      "Cannot modify a Root user",
    );

    const user = await this.deps.userRepository.update(input.id, {
      email: input.email,
      name: input.name,
      isActive: input.isActive,
    });
    if (!user) throw new NotFoundError("User not found");
    return user;
  }
}

export class DeleteUserUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      authorizationRepository: AuthorizationRepository;
    },
  ) {}

  async execute(input: { id: string; callerUserId?: string }) {
    await ensureCallerCanModifyRootUser(
      this.deps,
      input.id,
      input.callerUserId,
      "Cannot delete a Root user",
    );

    const deleted = await this.deps.userRepository.delete(input.id);
    if (!deleted) throw new NotFoundError("User not found");
  }
}

/** Deletes the current user (self-deletion). Auth only; no permission check. */
export class DeleteCurrentUserUseCase {
  constructor(private readonly deps: { userRepository: UserRepository }) {}

  async execute(input: { userId: string }) {
    const deleted = await this.deps.userRepository.delete(input.userId);
    if (!deleted) throw new NotFoundError("User not found");
  }
}

export class SetUserRolesUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      roleRepository: RoleRepository;
      userRoleRepository: UserRoleRepository;
      policyHistoryRepository: PolicyHistoryRepository;
      permissionRepository: PermissionRepository;
      rolePermissionRepository: RolePermissionRepository;
      authorizationRepository: AuthorizationRepository;
    },
  ) {}

  async execute(input: {
    userId: string;
    roleIds: string[];
    policyVersion?: number;
    actorId?: string;
    requestId?: string;
  }) {
    const user = await this.deps.userRepository.findById(input.userId);
    if (!user) throw new NotFoundError("User not found");

    const currentAssignments =
      await this.deps.userRoleRepository.listRolesByUserId(input.userId);
    const currentRoleIds = new Set(currentAssignments.map((a) => a.roleId));
    const nextRoleIds = new Set(input.roleIds);

    const targetIsRoot = this.deps.authorizationRepository.isRootUser
      ? await this.deps.authorizationRepository.isRootUser(input.userId)
      : false;
    if (targetIsRoot) {
      throw new ForbiddenError(
        "Cannot modify roles for a Root user via the application. Use the provided script.",
      );
    }

    const selectedPermissionIds = [
      ...new Set(
        (
          await Promise.all(
            input.roleIds.map(async (roleId) =>
              (
                await this.deps.rolePermissionRepository.listPermissionsByRoleId(
                  roleId,
                )
              ).map((assignment) => assignment.permissionId),
            ),
          )
        ).flat(),
      ),
    ];
    if (selectedPermissionIds.length > 0) {
      const selectedPermissions =
        await this.deps.permissionRepository.findByIds(selectedPermissionIds);
      const rootPermissionIds = new Set(
        selectedPermissions
          .filter((permission) => permission.isRoot === true)
          .map((permission) => permission.id),
      );
      if (
        selectedPermissionIds.some((permissionId) =>
          rootPermissionIds.has(permissionId),
        )
      ) {
        throw new ForbiddenError(
          "Cannot assign Root role via the application. Use the provided script.",
        );
      }
    }

    await this.deps.userRoleRepository.setUserRoles(
      input.userId,
      input.roleIds,
    );

    if (input.policyVersion !== undefined) {
      const addedCount = [...nextRoleIds].filter(
        (roleId) => !currentRoleIds.has(roleId),
      ).length;
      const removedCount = [...currentRoleIds].filter(
        (roleId) => !nextRoleIds.has(roleId),
      ).length;

      await this.deps.policyHistoryRepository.create({
        policyVersion: input.policyVersion,
        changeType: "user_roles",
        targetId: input.userId,
        targetType: "user",
        actorId: input.actorId,
        requestId: input.requestId,
        targetCount: nextRoleIds.size,
        addedCount,
        removedCount,
      });
    }

    const roles = await this.deps.roleRepository.list();
    return roles.filter((role) => input.roleIds.includes(role.id));
  }
}
