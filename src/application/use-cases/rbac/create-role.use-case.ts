import { type RoleRepository } from "#/application/ports/rbac";

export class CreateRoleUseCase {
  constructor(private readonly deps: { roleRepository: RoleRepository }) {}

  execute(input: { name: string; description?: string | null }) {
    return this.deps.roleRepository.create({
      name: input.name,
      description: input.description ?? null,
    });
  }
}
