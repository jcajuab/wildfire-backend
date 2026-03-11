import { type RoleRepository } from "#/application/ports/rbac";
import { normalizeQuery } from "./shared";

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
