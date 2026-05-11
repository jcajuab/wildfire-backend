import { type UserRepository } from "#/application/ports/rbac";
import { filterUsers, sortUsers } from "./shared";

export class ListUserOptionsUseCase {
  constructor(private readonly deps: { userRepository: UserRepository }) {}

  async execute(input?: { q?: string; limit?: number }) {
    if (this.deps.userRepository.listOptions) {
      return this.deps.userRepository.listOptions(input ?? {});
    }

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

  async executePage(input?: { q?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, input?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, input?.pageSize ?? 50));
    const offset = (page - 1) * pageSize;

    if (this.deps.userRepository.listOptionsPage) {
      const result = await this.deps.userRepository.listOptionsPage({
        q: input?.q,
        offset,
        limit: pageSize,
      });
      return { ...result, page, pageSize };
    }

    if (this.deps.userRepository.listPage) {
      const result = await this.deps.userRepository.listPage({
        q: input?.q,
        offset,
        limit: pageSize,
        sortBy: "name",
        sortDirection: "asc",
      });
      return { ...result, page, pageSize };
    }

    const users = sortUsers(
      filterUsers(await this.deps.userRepository.list(), input?.q),
      {
        sortBy: "name",
        sortDirection: "asc",
      },
    );

    return {
      items: users.slice(offset, offset + pageSize),
      total: users.length,
      page,
      pageSize,
    };
  }
}
