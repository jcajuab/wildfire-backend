import { type InvitationEmailSender } from "#/application/ports/notifications";
import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";

export class LogInvitationEmailSender implements InvitationEmailSender {
  async sendInvite(input: {
    email: string;
    inviteUrl: string;
    expiresAt: Date;
  }): Promise<void> {
    logger.info(
      {
        component: "notifications",
        event: "email.invite.requested",
        route: "/auth/invitations",
        expiresAt: input.expiresAt.toISOString(),
      },
      "Invitation email dispatch requested",
    );

    if (env.NODE_ENV === "development") {
      logger.info(
        {
          component: "notifications",
          event: "email.invite.previewed",
          route: "/auth/invitations",
          inviteUrl: input.inviteUrl,
        },
        "Development invite link preview",
      );
    }
  }
}
