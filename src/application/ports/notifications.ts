export interface EmailSender {
  sendInvite(input: {
    email: string;
    inviteUrl: string;
    expiresAt: Date;
  }): Promise<void>;

  sendResetLink(input: {
    email: string;
    resetUrl: string;
    expiresAt: Date;
  }): Promise<void>;

  sendVerificationLink(input: {
    email: string;
    verifyUrl: string;
    expiresAt: Date;
  }): Promise<void>;
}

/** @deprecated Use EmailSender instead */
export interface InvitationEmailSender {
  sendInvite(input: {
    email: string;
    inviteUrl: string;
    expiresAt: Date;
  }): Promise<void>;
}

/** @deprecated Use EmailSender instead */
export interface PasswordResetEmailSender {
  sendResetLink(input: {
    email: string;
    resetUrl: string;
    expiresAt: Date;
  }): Promise<void>;
}

/** @deprecated Use EmailSender instead */
export interface EmailChangeVerificationEmailSender {
  sendVerificationLink(input: {
    email: string;
    verifyUrl: string;
    expiresAt: Date;
  }): Promise<void>;
}
