import { ForbiddenError } from "#/application/errors/forbidden";
import {
  type AuthorizationRepository,
  type PermissionRepository,
  type RolePermissionRepository,
  type RoleRepository,
  type UserRepository,
  type UserRoleRepository,
} from "#/application/ports/rbac";
import { NotFoundError } from "./errors";

export class SetUserRolesUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      roleRepository: RoleRepository;
      userRoleRepository: UserRoleRepository;
      permissionRepository: PermissionRepository;
      rolePermissionRepository: RolePermissionRepository;
      authorizationRepository: AuthorizationRepository;
    },
  ) {}

  async execute(input: {
    userId: string;
    roleIds: string[];
    callerUserId?: string;
    actorId?: string;
    requestId?: string;
  }) {
    const user = await this.deps.userRepository.findById(input.userId);
    if (!user) throw new NotFoundError("User not found");

    const targetIsAdmin = this.deps.authorizationRepository.isAdminUser
      ? await this.deps.authorizationRepository.isAdminUser(input.userId)
      : false;
    if (targetIsAdmin) {
      throw new ForbiddenError(
        "Cannot modify roles for an Admin user via the application.",
      );
    }

    const selectedPermissionIds = [
      ...new Set(
        (
          await Promise.all(
            input.roleIds.map(async (roleId) =>
              (
                await this.deps.rolePermissionRepository.listPermissionsByRoleId(
                  roleId,
                )
              ).map((assignment) => assignment.permissionId),
            ),
          )
        ).flat(),
      ),
    ];

    if (selectedPermissionIds.length > 0) {
      const selectedPermissions =
        await this.deps.permissionRepository.findByIds(selectedPermissionIds);
      const hasAdminPermission = selectedPermissions.some(
        (permission) => permission.isAdmin === true,
      );

      if (hasAdminPermission) {
        const callerIsAdmin =
          input.callerUserId && this.deps.authorizationRepository.isAdminUser
            ? await this.deps.authorizationRepository.isAdminUser(
                input.callerUserId,
              )
            : false;
        if (!callerIsAdmin) {
          throw new ForbiddenError(
            "Only Admin users can assign the Admin role.",
          );
        }
      }
    }

    await this.deps.userRoleRepository.setUserRoles(
      input.userId,
      input.roleIds,
    );

    const roles = await this.deps.roleRepository.list();
    return roles.filter((role) => input.roleIds.includes(role.id));
  }
}
