export interface InvitationEmailSender {
  sendInvite(input: {
    email: string;
    inviteUrl: string;
    expiresAt: Date;
  }): Promise<void>;
}
