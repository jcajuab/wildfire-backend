import { ForbiddenError } from "#/application/errors/forbidden";
import {
  type PermissionRepository,
  type RolePermissionRepository,
  type RoleRepository,
} from "#/application/ports/rbac";
import { NotFoundError } from "./errors";

export class SetRolePermissionsUseCase {
  constructor(
    private readonly deps: {
      roleRepository: RoleRepository;
      rolePermissionRepository: RolePermissionRepository;
      permissionRepository: PermissionRepository;
    },
  ) {}

  async execute(input: {
    roleId: string;
    permissionIds: string[];
    actorId?: string;
    requestId?: string;
  }) {
    const role = await this.deps.roleRepository.findById(input.roleId);
    if (!role) throw new NotFoundError("Role not found");

    const selectedPermissions = await this.deps.permissionRepository.findByIds(
      input.permissionIds,
    );
    if (selectedPermissions.some((permission) => permission.isAdmin)) {
      throw new ForbiddenError(
        "Cannot assign Admin permission via the application.",
      );
    }

    await this.deps.rolePermissionRepository.setRolePermissions(
      input.roleId,
      input.permissionIds,
    );

    return selectedPermissions;
  }
}
