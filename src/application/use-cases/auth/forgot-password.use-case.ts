import { createHash, randomUUID } from "node:crypto";
import { type PasswordResetTokenRepository } from "#/application/ports/auth";
import { type PasswordResetEmailSender } from "#/application/ports/notifications";
import { type UserRepository } from "#/application/ports/rbac";

const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const DEFAULT_RESET_PASSWORD_BASE_URL = "http://localhost:3000/reset-password";

function buildResetPasswordUrl(baseUrl: string, token: string): string {
  const normalized = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalized}?token=${encodeURIComponent(token)}`;
}

export class ForgotPasswordUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      passwordResetTokenRepository: PasswordResetTokenRepository;
      passwordResetEmailSender: PasswordResetEmailSender;
      resetPasswordBaseUrl: string;
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

    const resetUrl = buildResetPasswordUrl(
      this.deps.resetPasswordBaseUrl ?? DEFAULT_RESET_PASSWORD_BASE_URL,
      token,
    );

    await this.deps.passwordResetEmailSender.sendResetLink({
      email: input.email,
      resetUrl,
      expiresAt,
    });
  }
}

export { buildResetPasswordUrl, hashToken };
