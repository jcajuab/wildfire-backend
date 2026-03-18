import { type AuthorizationRepository } from "#/application/ports/rbac";
import { Permission } from "#/domain/rbac/permission";

interface CheckPermissionDeps {
  authorizationRepository: AuthorizationRepository;
}

export class CheckPermissionUseCase {
  constructor(private readonly deps: CheckPermissionDeps) {}

  async execute(input: { userId: string; required: string }): Promise<boolean> {
    const isAdmin = await this.deps.authorizationRepository.isAdminUser(
      input.userId,
    );
    if (isAdmin) {
      return true;
    }

    const requiredPermission = Permission.parse(input.required);
    const permissions =
      await this.deps.authorizationRepository.findPermissionsForUser(
        input.userId,
      );

    return permissions.some((permission) =>
      permission.matches(requiredPermission),
    );
  }
}
