import { createHash, randomUUID } from "node:crypto";
import { ValidationError } from "#/application/errors/validation";
import { type EmailChangeTokenRepository } from "#/application/ports/auth";
import { type EmailChangeVerificationEmailSender } from "#/application/ports/notifications";
import { type UserRepository } from "#/application/ports/rbac";
import {
  DuplicateEmailError,
  NotFoundError,
} from "#/application/use-cases/rbac/errors";

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const buildVerifyEmailChangeUrl = (baseUrl: string, token: string): string => {
  const normalized = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalized}?token=${encodeURIComponent(token)}`;
};

export class RequestEmailChangeUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      emailChangeTokenRepository: EmailChangeTokenRepository;
      emailChangeVerificationEmailSender: EmailChangeVerificationEmailSender;
      emailChangeTokenTtlSeconds: number;
      emailChangeVerifyBaseUrl: string;
    },
  ) {}

  async execute(input: {
    userId: string;
    email: string;
  }): Promise<{ pendingEmail: string; expiresAt: string }> {
    const user = await this.deps.userRepository.findById(input.userId);
    if (!user) throw new NotFoundError("User not found");

    const email = normalizeEmail(input.email);
    if (email.length === 0) {
      throw new ValidationError("Email is required.");
    }
    if (user.email?.trim().toLowerCase() === email) {
      throw new ValidationError(
        "New email must be different from current email.",
      );
    }

    const existingUser = await this.deps.userRepository.findByEmail(email);
    if (existingUser && existingUser.id !== input.userId) {
      throw new DuplicateEmailError();
    }

    const now = new Date();
    await this.deps.emailChangeTokenRepository.deleteExpired(now);
    await this.deps.emailChangeTokenRepository.deleteByUserId(input.userId);

    const token = randomUUID();
    const hashedToken = hashToken(token);
    const expiresAt = new Date(
      now.getTime() + this.deps.emailChangeTokenTtlSeconds * 1000,
    );
    const verifyUrl = buildVerifyEmailChangeUrl(
      this.deps.emailChangeVerifyBaseUrl,
      token,
    );

    await this.deps.emailChangeTokenRepository.store({
      userId: input.userId,
      email,
      hashedToken,
      expiresAt,
    });

    await this.deps.emailChangeVerificationEmailSender.sendVerificationLink({
      email,
      verifyUrl,
      expiresAt,
    });

    return {
      pendingEmail: email,
      expiresAt: expiresAt.toISOString(),
    };
  }
}

export { buildVerifyEmailChangeUrl, hashToken, normalizeEmail };
