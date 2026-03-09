import { ForbiddenError } from "#/application/errors/forbidden";
import {
  type AuthorizationRepository,
  type PermissionRepository,
  type RolePermissionRepository,
  type RoleRepository,
  type UserRecord,
  type UserRepository,
  type UserRoleRepository,
} from "#/application/ports/rbac";
import {
  DuplicateEmailError,
  DuplicateUsernameError,
  NotFoundError,
} from "#/application/use-cases/rbac/errors";
import { paginate } from "#/application/use-cases/shared/pagination";

const normalizeQuery = (value: string | undefined): string | null => {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
};

const filterUsers = (
  users: readonly UserRecord[],
  query: string | undefined,
): UserRecord[] => {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return [...users];
  }

  return users.filter((user) => {
    return (
      user.name.toLowerCase().includes(normalized) ||
      user.username.toLowerCase().includes(normalized) ||
      (user.email?.toLowerCase().includes(normalized) ?? false)
    );
  });
};

const sortUsers = (
  users: readonly UserRecord[],
  input?: { sortBy?: "name" | "lastSeenAt"; sortDirection?: "asc" | "desc" },
): UserRecord[] => {
  const sortBy = input?.sortBy ?? "name";
  const direction = input?.sortDirection === "desc" ? -1 : 1;

  return [...users].sort((left, right) => {
    if (sortBy === "lastSeenAt") {
      if (left.lastSeenAt == null && right.lastSeenAt == null) {
        return left.name.localeCompare(right.name) * direction;
      }
      if (left.lastSeenAt == null) {
        return 1;
      }
      if (right.lastSeenAt == null) {
        return -1;
      }

      const lastSeenDelta =
        input?.sortDirection === "desc"
          ? right.lastSeenAt.localeCompare(left.lastSeenAt)
          : left.lastSeenAt.localeCompare(right.lastSeenAt);
      if (lastSeenDelta !== 0) {
        return lastSeenDelta;
      }
      return left.name.localeCompare(right.name) * direction;
    }

    return left.name.localeCompare(right.name) * direction;
  });
};

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

  async execute(input?: {
    page?: number;
    pageSize?: number;
    q?: string;
    sortBy?: "name" | "lastSeenAt";
    sortDirection?: "asc" | "desc";
  }) {
    const all = await this.deps.userRepository.list();
    return paginate(sortUsers(filterUsers(all, input?.q), input), input);
  }
}

export class ListUserOptionsUseCase {
  constructor(private readonly deps: { userRepository: UserRepository }) {}

  async execute(input?: { q?: string; limit?: number }) {
    const limit = input?.limit;
    const users = sortUsers(
      filterUsers(await this.deps.userRepository.list(), input?.q),
      {
        sortBy: "name",
        sortDirection: "asc",
      },
    );

    return limit != null ? users.slice(0, Math.max(1, limit)) : users;
  }
}

export class CreateUserUseCase {
  constructor(private readonly deps: { userRepository: UserRepository }) {}

  async execute(input: {
    username: string;
    email?: string | null;
    name: string;
    isActive?: boolean;
  }) {
    const existing = await this.deps.userRepository.findByUsername(
      input.username,
    );
    if (existing) throw new DuplicateUsernameError();
    if (input.email) {
      const existingEmail = await this.deps.userRepository.findByEmail(
        input.email,
      );
      if (existingEmail) throw new DuplicateEmailError();
    }
    return this.deps.userRepository.create({
      username: input.username,
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
    username?: string;
    email?: string | null;
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

    if (input.username) {
      const existingByUsername = await this.deps.userRepository.findByUsername(
        input.username,
      );
      if (existingByUsername && existingByUsername.id !== input.id) {
        throw new DuplicateUsernameError();
      }
    }
    if (input.email) {
      const existingByEmail = await this.deps.userRepository.findByEmail(
        input.email,
      );
      if (existingByEmail && existingByEmail.id !== input.id) {
        throw new DuplicateEmailError();
      }
    }

    const user = await this.deps.userRepository.update(input.id, {
      username: input.username,
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
      permissionRepository: PermissionRepository;
      rolePermissionRepository: RolePermissionRepository;
      authorizationRepository: AuthorizationRepository;
    },
  ) {}

  async execute(input: {
    userId: string;
    roleIds: string[];
    actorId?: string;
    requestId?: string;
  }) {
    const user = await this.deps.userRepository.findById(input.userId);
    if (!user) throw new NotFoundError("User not found");

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

    const roles = await this.deps.roleRepository.list();
    return roles.filter((role) => input.roleIds.includes(role.id));
  }
}
