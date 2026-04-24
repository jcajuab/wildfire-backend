import { ValidationError } from "#/application/errors/validation";
import { type RoleRepository } from "#/application/ports/rbac";

export class CreateRoleUseCase {
  constructor(private readonly deps: { roleRepository: RoleRepository }) {}

  async execute(input: { name: string; description?: string | null }) {
    const existing = await this.deps.roleRepository.findByName(input.name);
    if (existing) {
      throw new ValidationError("A role with this name already exists.");
    }

    return this.deps.roleRepository.create({
      name: input.name,
      description: input.description ?? null,
    });
  }
}
