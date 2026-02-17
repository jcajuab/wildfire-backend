import { createHash, randomUUID } from "node:crypto";
import { type PasswordResetTokenRepository } from "#/application/ports/auth";
import { type UserRepository } from "#/application/ports/rbac";

const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class ForgotPasswordUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      passwordResetTokenRepository: PasswordResetTokenRepository;
    },
  ) {}

  async execute(input: { email: string }): Promise<void> {
    // Clean up expired tokens on each request to prevent unbounded growth
    await this.deps.passwordResetTokenRepository.deleteExpired(new Date());

    const user = await this.deps.userRepository.findByEmail(input.email);
    if (!user) {
      // Return silently to prevent email enumeration
      return;
    }

    const token = randomUUID();
    const hashedToken = hashToken(token);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

    await this.deps.passwordResetTokenRepository.store({
      hashedToken,
      email: input.email,
      expiresAt,
    });

    // In a real system, send `token` (not hashed) to the user via email.
    // For now, the token is returned via a side-channel or log in dev only.
    if (process.env.NODE_ENV === "development") {
      console.info(`[dev] Password reset token for ${input.email}: ${token}`);
    }
  }
}

export { hashToken };
