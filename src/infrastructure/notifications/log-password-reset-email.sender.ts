import { type PasswordResetEmailSender } from "#/application/ports/notifications";
import { logger } from "#/infrastructure/observability/logger";

export class LogPasswordResetEmailSender implements PasswordResetEmailSender {
  async sendResetLink(input: {
    email: string;
    resetUrl: string;
    expiresAt: Date;
  }): Promise<void> {
    logger.info(
      {
        route: "/auth/password/forgot",
        expiresAt: input.expiresAt.toISOString(),
      },
      "Password reset email dispatch requested",
    );

    if (process.env.NODE_ENV === "development") {
      logger.info(
        {
          route: "/auth/password/forgot",
          resetUrl: input.resetUrl,
        },
        "Development password reset link preview",
      );
    }
  }
}
