import { ForbiddenError } from "#/application/errors/forbidden";
import {
  type PermissionRepository,
  type RolePermissionRepository,
  type RoleRecord,
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

const normalizeQuery = (value: string | undefined): string | null => {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
};

const filterRoles = (
  roles: readonly RoleWithUserCount[],
  query: string | undefined,
): RoleWithUserCount[] => {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return [...roles];
  }

  return roles.filter((role) => {
    return (
      role.name.toLowerCase().includes(normalized) ||
      (role.description?.toLowerCase().includes(normalized) ?? false)
    );
  });
};

const sortRoles = (
  roles: readonly RoleWithUserCount[],
  input?: { sortBy?: "name" | "usersCount"; sortDirection?: "asc" | "desc" },
): RoleWithUserCount[] => {
  const sortBy = input?.sortBy ?? "name";
  const direction = input?.sortDirection === "desc" ? -1 : 1;

  return [...roles].sort((left, right) => {
    if (sortBy === "usersCount") {
      const countDelta = (left.usersCount - right.usersCount) * direction;
      if (countDelta !== 0) {
        return countDelta;
      }
      return left.name.localeCompare(right.name) * direction;
    }

    return left.name.localeCompare(right.name) * direction;
  });
};

const toRoleWithUserCount = (
  role: RoleRecord,
  usersCount: number,
): RoleWithUserCount => ({
  ...role,
  usersCount,
});

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
    q?: string;
    sortBy?: "name" | "usersCount";
    sortDirection?: "asc" | "desc";
  }): Promise<PaginatedResult<RoleWithUserCount>> {
    const roles = await this.deps.roleRepository.list();
    const roleIds = roles.map((r) => r.id);
    const counts =
      await this.deps.userRoleRepository.listUserCountByRoleIds(roleIds);
    const enriched = roles.map((role) =>
      toRoleWithUserCount(role, counts[role.id] ?? 0),
    );
    return paginate(sortRoles(filterRoles(enriched, input?.q), input), input);
  }
}

export class ListRoleOptionsUseCase {
  constructor(private readonly deps: { roleRepository: RoleRepository }) {}

  async execute(input?: { q?: string; limit?: number }) {
    const normalizedQuery = normalizeQuery(input?.q);
    const limit = input?.limit;

    const roles = (await this.deps.roleRepository.list())
      .filter((role) => {
        if (!normalizedQuery) {
          return true;
        }

        return (
          role.name.toLowerCase().includes(normalizedQuery) ||
          (role.description?.toLowerCase().includes(normalizedQuery) ?? false)
        );
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    return limit != null ? roles.slice(0, Math.max(1, limit)) : roles;
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
    },
  ) {}

  async execute(input: { id: string; callerUserId?: string }) {
    const role = await this.deps.roleRepository.findById(input.id);
    if (!role) throw new NotFoundError("Role not found");
    if (role.isSystem) {
      throw new ForbiddenError("Cannot delete system role");
    }

    const deleted = await this.deps.roleRepository.delete(input.id);
    if (!deleted) throw new NotFoundError("Role not found");
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
    },
  ) {}

  async execute(input: {
    roleId: string;
    permissionIds: string[];
    actorId?: string;
    requestId?: string;
  }) {
    const role = await this.deps.roleRepository.findById(input.roleId);
    if (!role) throw new NotFoundError("Role not found");
    if (role.isSystem) {
      throw new ForbiddenError("Cannot modify permissions of system role");
    }

    const selectedPermissions = await this.deps.permissionRepository.findByIds(
      input.permissionIds,
    );
    if (selectedPermissions.some((permission) => permission.isRoot)) {
      throw new ForbiddenError(
        "Cannot assign Root permission via the application. Use the provided script.",
      );
    }

    await this.deps.rolePermissionRepository.setRolePermissions(
      input.roleId,
      input.permissionIds,
    );

    return selectedPermissions;
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
