import { type UserRepository } from "#/application/ports/rbac";
import { DuplicateEmailError, DuplicateUsernameError } from "./errors";

export class CreateUserUseCase {
  constructor(private readonly deps: { userRepository: UserRepository }) {}

  async execute(input: {
    username: string;
    email?: string | null;
    name: string;
    isActive?: boolean;
  }) {
    const existing = await this.deps.userRepository.findByUsername(
      input.username,
    );
    if (existing) throw new DuplicateUsernameError();
    if (input.email) {
      const existingEmail = await this.deps.userRepository.findByEmail(
        input.email,
      );
      if (existingEmail) throw new DuplicateEmailError();
    }
    return this.deps.userRepository.create({
      username: input.username,
      email: input.email,
      name: input.name,
      isActive: input.isActive,
    });
  }
}
