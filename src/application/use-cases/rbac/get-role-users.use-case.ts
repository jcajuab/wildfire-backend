import {
  type RoleRepository,
  type UserRepository,
  type UserRoleRepository,
} from "#/application/ports/rbac";
import { paginate } from "#/application/use-cases/shared/pagination";
import { NotFoundError } from "./errors";

export class GetRoleUsersUseCase {
  constructor(
    private readonly deps: {
      roleRepository: RoleRepository;
      userRoleRepository: UserRoleRepository;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input: { roleId: string; page?: number; pageSize?: number }) {
    const role = await this.deps.roleRepository.findById(input.roleId);
    if (!role) throw new NotFoundError("Role not found");

    const userIds = await this.deps.userRoleRepository.listUserIdsByRoleId(
      input.roleId,
    );
    if (userIds.length === 0) {
      return paginate([], {
        page: input.page,
        pageSize: input.pageSize,
      });
    }

    const users = await this.deps.userRepository.findByIds(userIds);
    return paginate(users, {
      page: input.page,
      pageSize: input.pageSize,
    });
  }
}
