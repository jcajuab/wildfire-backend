import { ForbiddenError } from "#/application/errors/forbidden";
import {
  type PermissionRepository,
  type RolePermissionRepository,
  type RoleRepository,
  type UserRoleRepository,
} from "#/application/ports/rbac";
import { NotFoundError } from "./errors";

export class SetRolePermissionsUseCase {
  constructor(
    private readonly deps: {
      roleRepository: RoleRepository;
      rolePermissionRepository: RolePermissionRepository;
      permissionRepository: PermissionRepository;
      userRoleRepository?: UserRoleRepository;
      onPermissionsChanged?: (userId: string) => Promise<void>;
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

    if (this.deps.userRoleRepository && this.deps.onPermissionsChanged) {
      const affectedUserIds =
        await this.deps.userRoleRepository.listUserIdsByRoleId(input.roleId);
      await Promise.all(
        affectedUserIds.map((userId) =>
          this.deps.onPermissionsChanged?.(userId),
        ),
      );
    }

    return selectedPermissions;
  }
}
