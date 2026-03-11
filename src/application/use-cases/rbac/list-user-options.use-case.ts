import { type UserRepository } from "#/application/ports/rbac";
import { filterUsers, sortUsers } from "./shared";

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
