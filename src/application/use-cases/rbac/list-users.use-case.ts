import { type UserRepository } from "#/application/ports/rbac";
import { paginate } from "#/application/use-cases/shared/pagination";
import { filterUsers, sortUsers } from "./shared";

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
