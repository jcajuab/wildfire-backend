import { ValidationError } from "#/application/errors/validation";
import {
  type AuthSessionRepository,
  type CredentialsRepository,
  type PasswordHasher,
  type PasswordResetTokenRepository,
} from "#/application/ports/auth";
import { type UserRepository } from "#/application/ports/rbac";
import { hashToken } from "#/application/use-cases/auth/forgot-password.use-case";

export class ResetPasswordUseCase {
  constructor(
    private readonly deps: {
      passwordResetTokenRepository: PasswordResetTokenRepository;
      credentialsRepository: CredentialsRepository;
      passwordHasher: PasswordHasher;
      userRepository: UserRepository;
      authSessionRepository: AuthSessionRepository;
    },
  ) {}

  async execute(input: { token: string; newPassword: string }): Promise<void> {
    const hashedToken = hashToken(input.token);
    const reset =
      await this.deps.passwordResetTokenRepository.findByHashedToken(
        hashedToken,
        new Date(),
      );

    if (!reset) {
      throw new ValidationError("Reset token is invalid or expired.");
    }

    const passwordHash = await this.deps.passwordHasher.hash(input.newPassword);
    await this.deps.credentialsRepository.updatePasswordHash(
      reset.email,
      passwordHash,
    );

    // Revoke all sessions for the user
    const user = await this.deps.userRepository.findByEmail(reset.email);
    if (user) {
      await this.deps.authSessionRepository.revokeAllForUser(user.id);
    }

    // Consume the token so it cannot be reused
    await this.deps.passwordResetTokenRepository.consumeByHashedToken(
      hashedToken,
    );
  }
}
