import { type RoleRepository } from "#/application/ports/rbac";
import { NotFoundError } from "./errors";

export class GetRoleUseCase {
  constructor(private readonly deps: { roleRepository: RoleRepository }) {}

  async execute(input: { id: string }) {
    const role = await this.deps.roleRepository.findById(input.id);
    if (!role) throw new NotFoundError("Role not found");
    return role;
  }
}
