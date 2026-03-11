import {
  type PermissionRepository,
  type RolePermissionRepository,
  type RoleRepository,
} from "#/application/ports/rbac";
import { paginate } from "#/application/use-cases/shared/pagination";
import { NotFoundError } from "./errors";

export class GetRolePermissionsUseCase {
  constructor(
    private readonly deps: {
      roleRepository: RoleRepository;
      rolePermissionRepository: RolePermissionRepository;
      permissionRepository: PermissionRepository;
    },
  ) {}

  async execute(input: { roleId: string; page?: number; pageSize?: number }) {
    const role = await this.deps.roleRepository.findById(input.roleId);
    if (!role) throw new NotFoundError("Role not found");

    const rolePermissions =
      await this.deps.rolePermissionRepository.listPermissionsByRoleId(
        input.roleId,
      );
    const permissionIds = rolePermissions.map((item) => item.permissionId);
    const permissions =
      await this.deps.permissionRepository.findByIds(permissionIds);
    return paginate(permissions, {
      page: input.page,
      pageSize: input.pageSize,
    });
  }
}
