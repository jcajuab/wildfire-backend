import { ForbiddenError } from "#/application/errors/forbidden";
import { type RoleRepository } from "#/application/ports/rbac";
import { ADMIN_ROLE_NAME } from "#/domain/rbac/canonical-permissions";
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
    if (role.name === ADMIN_ROLE_NAME) {
      throw new ForbiddenError(
        "The Admin role is protected and cannot be deleted.",
      );
    }
    const deleted = await this.deps.roleRepository.delete(input.id);
    if (!deleted) throw new NotFoundError("Role not found");
  }
}
