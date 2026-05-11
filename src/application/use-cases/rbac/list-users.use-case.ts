import {
  type UserRepository,
  type UserTypeFilter,
} from "#/application/ports/rbac";
import { paginate } from "#/application/use-cases/shared/pagination";
import { filterUsers, sortUsers } from "./shared";

export class ListUsersUseCase {
  constructor(private readonly deps: { userRepository: UserRepository }) {}

  async execute(input?: {
    page?: number;
    pageSize?: number;
    q?: string;
    roleId?: string;
    userType?: UserTypeFilter;
    sortBy?: "name" | "email" | "lastSeenAt";
    sortDirection?: "asc" | "desc";
  }) {
    const page = Math.max(Math.trunc(input?.page ?? 1), 1);
    const pageSize = Math.min(
      Math.max(Math.trunc(input?.pageSize ?? 20), 1),
      100,
    );
    const offset = (page - 1) * pageSize;

    if (this.deps.userRepository.listPage) {
      const result = await this.deps.userRepository.listPage({
        offset,
        limit: pageSize,
        q: input?.q,
        roleId: input?.roleId,
        userType: input?.userType,
        sortBy: input?.sortBy,
        sortDirection: input?.sortDirection,
      });
      return {
        items: result.items,
        total: result.total,
        page,
        pageSize,
      };
    }

    const all = await this.deps.userRepository.list();
    return paginate(
      sortUsers(filterUsers(all, input?.q, input?.userType), input),
      input,
    );
  }
}
