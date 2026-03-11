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
    const role = await this.deps.roleRepository.update(input.id, {
      name: input.name,
      description: input.description,
    });
    if (!role) throw new NotFoundError("Role not found");
    return role;
  }
}
