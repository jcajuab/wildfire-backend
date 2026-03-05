import { type EmailChangeVerificationEmailSender } from "#/application/ports/notifications";
import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";

export class LogEmailChangeVerificationEmailSender
  implements EmailChangeVerificationEmailSender
{
  async sendVerificationLink(input: {
    email: string;
    verifyUrl: string;
    expiresAt: Date;
  }): Promise<void> {
    logger.info(
      {
        component: "notifications",
        event: "email.profile_change.requested",
        route: "/auth/profile/email-change/request",
        expiresAt: input.expiresAt.toISOString(),
      },
      "Email change verification dispatch requested",
    );

    if (env.NODE_ENV === "development") {
      logger.info(
        {
          component: "notifications",
          event: "email.profile_change.previewed",
          route: "/auth/profile/email-change/request",
          verifyUrl: input.verifyUrl,
        },
        "Development email change verification link preview",
      );
    }
  }
}
