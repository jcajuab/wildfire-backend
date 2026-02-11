import {
  type CredentialsRepository,
  type PasswordHasher,
  type PasswordVerifier,
} from "#/application/ports/auth";
import { type UserRepository } from "#/application/ports/rbac";
import { InvalidCredentialsError } from "#/application/use-cases/auth/errors";
import { NotFoundError } from "#/application/use-cases/rbac/errors";

export interface ChangeCurrentUserPasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
}

export class ChangeCurrentUserPasswordUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      credentialsRepository: CredentialsRepository;
      passwordVerifier: PasswordVerifier;
      passwordHasher: PasswordHasher;
    },
  ) {}

  async execute(input: ChangeCurrentUserPasswordInput): Promise<void> {
    const user = await this.deps.userRepository.findById(input.userId);
    if (!user) throw new NotFoundError("User not found");

    const currentHash = await this.deps.credentialsRepository.findPasswordHash(
      user.email,
    );
    if (!currentHash)
      throw new InvalidCredentialsError("Current password is incorrect");

    const verified = await this.deps.passwordVerifier.verify({
      password: input.currentPassword,
      passwordHash: currentHash,
    });
    if (!verified) {
      throw new InvalidCredentialsError("Current password is incorrect");
    }

    const newHash = await this.deps.passwordHasher.hash(input.newPassword);
    await this.deps.credentialsRepository.updatePasswordHash(
      user.email,
      newHash,
    );
  }
}
