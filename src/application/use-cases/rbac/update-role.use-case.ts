import { ForbiddenError } from "#/application/errors/forbidden";
import { ValidationError } from "#/application/errors/validation";
import { type RoleRepository } from "#/application/ports/rbac";
import { NotFoundError } from "./errors";

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
      throw new ForbiddenError(
        "The Admin role is protected and cannot be modified.",
      );
    }
    if (input.name && input.name !== existing.name) {
      const duplicate = await this.deps.roleRepository.findByName(input.name);
      if (duplicate) {
        throw new ValidationError("A role with this name already exists.");
      }
    }
    const role = await this.deps.roleRepository.update(input.id, {
      name: input.name,
      description: input.description,
    });
    if (!role) throw new NotFoundError("Role not found");
    return role;
  }
}
