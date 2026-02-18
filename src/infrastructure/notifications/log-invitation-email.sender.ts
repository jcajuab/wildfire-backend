import { type InvitationEmailSender } from "#/application/ports/notifications";
import { logger } from "#/infrastructure/observability/logger";

export class LogInvitationEmailSender implements InvitationEmailSender {
  async sendInvite(input: {
    email: string;
    inviteUrl: string;
    expiresAt: Date;
  }): Promise<void> {
    logger.info(
      {
        route: "/auth/invitations",
        expiresAt: input.expiresAt.toISOString(),
      },
      "Invitation email dispatch requested",
    );

    if (process.env.NODE_ENV === "development") {
      logger.info(
        {
          route: "/auth/invitations",
          inviteUrl: input.inviteUrl,
        },
        "Development invite link preview",
      );
    }
  }
}
