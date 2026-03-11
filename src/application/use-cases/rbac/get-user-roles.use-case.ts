import {
  type RoleRepository,
  type UserRepository,
  type UserRoleRepository,
} from "#/application/ports/rbac";
import { paginate } from "#/application/use-cases/shared/pagination";
import { NotFoundError } from "./errors";

export class GetUserRolesUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      userRoleRepository: UserRoleRepository;
      roleRepository: RoleRepository;
    },
  ) {}

  async execute(input: { userId: string; page?: number; pageSize?: number }) {
    const user = await this.deps.userRepository.findById(input.userId);
    if (!user) throw new NotFoundError("User not found");

    const assignments = await this.deps.userRoleRepository.listRolesByUserId(
      input.userId,
    );
    const roleIds = assignments.map((a) => a.roleId);
    if (roleIds.length === 0) {
      return paginate([], {
        page: input.page,
        pageSize: input.pageSize,
      });
    }

    const roles = await this.deps.roleRepository.findByIds(roleIds);
    return paginate(roles, {
      page: input.page,
      pageSize: input.pageSize,
    });
  }
}
