import { type UserRepository } from "#/application/ports/rbac";
import { NotFoundError } from "./errors";

export class GetUserUseCase {
  constructor(private readonly deps: { userRepository: UserRepository }) {}

  async execute(input: { id: string }) {
    const user = await this.deps.userRepository.findById(input.id);
    if (!user) throw new NotFoundError("User not found");
    return user;
  }
}
