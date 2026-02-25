import { type PermissionRepository } from "#/application/ports/rbac";
import { paginate } from "#/application/use-cases/shared/pagination";

export class ListPermissionsUseCase {
  constructor(
    private readonly deps: { permissionRepository: PermissionRepository },
  ) {}

  async execute(input?: { page?: number; pageSize?: number }) {
    const all = (await this.deps.permissionRepository.list()).filter(
      (permission) => !permission.isRoot,
    );
    return paginate(all, input);
  }
}
