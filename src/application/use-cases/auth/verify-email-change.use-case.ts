import { ValidationError } from "#/application/errors/validation";
import { type EmailChangeTokenRepository } from "#/application/ports/auth";
import { type UserRepository } from "#/application/ports/rbac";
import { hashToken } from "#/application/use-cases/auth/request-email-change.use-case";
import {
  DuplicateEmailError,
  NotFoundError,
} from "#/application/use-cases/rbac/errors";

export class VerifyEmailChangeUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      emailChangeTokenRepository: EmailChangeTokenRepository;
    },
  ) {}

  async execute(input: { token: string }): Promise<void> {
    const hashedToken = hashToken(input.token);
    const pending =
      await this.deps.emailChangeTokenRepository.findByHashedToken(
        hashedToken,
        new Date(),
      );
    if (!pending) {
      throw new ValidationError(
        "Email verification token is invalid or expired.",
      );
    }

    const targetUser = await this.deps.userRepository.findById(pending.userId);
    if (!targetUser) {
      throw new NotFoundError("User not found");
    }

    const existingUser = await this.deps.userRepository.findByEmail(
      pending.email,
    );
    if (existingUser && existingUser.id !== pending.userId) {
      throw new DuplicateEmailError();
    }

    const updated = await this.deps.userRepository.update(pending.userId, {
      email: pending.email,
    });
    if (!updated) {
      throw new NotFoundError("User not found");
    }

    await this.deps.emailChangeTokenRepository.consumeByHashedToken(
      hashedToken,
    );
  }
}
