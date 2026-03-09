import { type PermissionRepository } from "#/application/ports/rbac";
import { paginate } from "#/application/use-cases/shared/pagination";

const normalizeQuery = (value: string | undefined): string | null => {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
};

export class ListPermissionsUseCase {
  constructor(
    private readonly deps: { permissionRepository: PermissionRepository },
  ) {}

  async execute(input?: { page?: number; pageSize?: number; q?: string }) {
    const all = (await this.deps.permissionRepository.list()).filter(
      (permission) => !permission.isRoot,
    );
    const query = normalizeQuery(input?.q);
    const filtered = query
      ? all.filter((permission) => {
          const label =
            `${permission.resource}:${permission.action}`.toLowerCase();
          return label.includes(query);
        })
      : all;
    return paginate(filtered, input);
  }
}

export class ListPermissionOptionsUseCase {
  constructor(
    private readonly deps: { permissionRepository: PermissionRepository },
  ) {}

  async execute(input?: { q?: string }) {
    const query = normalizeQuery(input?.q);
    const all = (await this.deps.permissionRepository.list()).filter(
      (permission) => !permission.isRoot,
    );

    const filtered = query
      ? all.filter((permission) =>
          `${permission.resource}:${permission.action}`
            .toLowerCase()
            .includes(query),
        )
      : all;

    return [...filtered].sort((left, right) =>
      `${left.resource}:${left.action}`.localeCompare(
        `${right.resource}:${right.action}`,
      ),
    );
  }
}
