import {
  type RoleRepository,
  type RoleWithUserCount,
  type UserRoleRepository,
} from "#/application/ports/rbac";
import {
  type PaginatedResult,
  paginate,
} from "#/application/use-cases/shared/pagination";
import { normalizeQuery } from "./shared";

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
    const enriched = roles.map((role) => ({
      ...role,
      usersCount: counts[role.id] ?? 0,
    }));
    return paginate(sortRoles(filterRoles(enriched, input?.q), input), input);
  }
}
