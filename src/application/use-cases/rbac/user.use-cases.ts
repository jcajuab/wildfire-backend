import { ForbiddenError } from "#/application/errors/forbidden";
import {
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

async function ensureCallerCanModifySuperAdminUser(
  deps: {
    userRoleRepository: UserRoleRepository;
    roleRepository: RoleRepository;
  },
  targetUserId: string,
  callerUserId: string | undefined,
  forbiddenMessage: string,
): Promise<void> {
  const allRoles = await deps.roleRepository.list();
  const systemRole = allRoles.find((r) => r.isSystem);
  if (!systemRole) return;

  const targetAssignments =
    await deps.userRoleRepository.listRolesByUserId(targetUserId);
  const targetRoleIds = targetAssignments.map((a) => a.roleId);
  if (!targetRoleIds.includes(systemRole.id)) return;

  if (callerUserId === undefined) {
    throw new ForbiddenError(forbiddenMessage);
  }

  const callerAssignments =
    await deps.userRoleRepository.listRolesByUserId(callerUserId);
  const callerRoleIds = callerAssignments.map((a) => a.roleId);
  if (!callerRoleIds.includes(systemRole.id)) {
    throw new ForbiddenError(forbiddenMessage);
  }
}

export class UpdateUserUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      userRoleRepository: UserRoleRepository;
      roleRepository: RoleRepository;
    },
  ) {}

  async execute(input: {
    id: string;
    email?: string;
    name?: string;
    isActive?: boolean;
    callerUserId?: string;
  }) {
    await ensureCallerCanModifySuperAdminUser(
      this.deps,
      input.id,
      input.callerUserId,
      "Cannot modify a Super Admin user",
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
      userRoleRepository: UserRoleRepository;
      roleRepository: RoleRepository;
    },
  ) {}

  async execute(input: { id: string; callerUserId?: string }) {
    await ensureCallerCanModifySuperAdminUser(
      this.deps,
      input.id,
      input.callerUserId,
      "Cannot delete a Super Admin user",
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
    },
  ) {}

  async execute(input: { userId: string; roleIds: string[] }) {
    const user = await this.deps.userRepository.findById(input.userId);
    if (!user) throw new NotFoundError("User not found");

    const allRoles = await this.deps.roleRepository.list();
    const systemRole = allRoles.find((r) => r.isSystem);
    if (systemRole) {
      if (input.roleIds.includes(systemRole.id)) {
        throw new ForbiddenError(
          "Cannot assign Super Admin role via the application. Use the provided script.",
        );
      }
      const currentAssignments =
        await this.deps.userRoleRepository.listRolesByUserId(input.userId);
      const currentRoleIds = currentAssignments.map((a) => a.roleId);
      if (
        currentRoleIds.includes(systemRole.id) &&
        !input.roleIds.includes(systemRole.id)
      ) {
        throw new ForbiddenError(
          "Cannot remove Super Admin role via the application. Use the provided script.",
        );
      }
    }

    await this.deps.userRoleRepository.setUserRoles(
      input.userId,
      input.roleIds,
    );

    const roles = await this.deps.roleRepository.list();
    return roles.filter((role) => input.roleIds.includes(role.id));
  }
}
