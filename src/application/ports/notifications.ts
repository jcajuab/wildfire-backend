export interface InvitationEmailSender {
  sendInvite(input: {
    email: string;
    inviteUrl: string;
    expiresAt: Date;
  }): Promise<void>;
}

export interface PasswordResetEmailSender {
  sendResetLink(input: {
    email: string;
    resetUrl: string;
    expiresAt: Date;
  }): Promise<void>;
}

export interface EmailChangeVerificationEmailSender {
  sendVerificationLink(input: {
    email: string;
    verifyUrl: string;
    expiresAt: Date;
  }): Promise<void>;
}
