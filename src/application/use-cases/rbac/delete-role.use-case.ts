import { type RoleRepository } from "#/application/ports/rbac";
import { NotFoundError } from "./errors";

export class DeleteRoleUseCase {
  constructor(
    private readonly deps: {
      roleRepository: RoleRepository;
    },
  ) {}

  async execute(input: { id: string; callerUserId?: string }) {
    const role = await this.deps.roleRepository.findById(input.id);
    if (!role) throw new NotFoundError("Role not found");
    const deleted = await this.deps.roleRepository.delete(input.id);
    if (!deleted) throw new NotFoundError("Role not found");
  }
}
