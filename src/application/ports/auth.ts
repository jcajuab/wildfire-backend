export interface CredentialsRepository {
  findPasswordHash(username: string): Promise<string | null>;
  updatePasswordHash(email: string, newPasswordHash: string): Promise<void>;
  createPasswordHash?(email: string, passwordHash: string): Promise<void>;
}

export interface PasswordHasher {
  hash(plainPassword: string): Promise<string>;
}

export interface PasswordVerifier {
  verify(input: { password: string; passwordHash: string }): Promise<boolean>;
}

export interface TokenIssuer {
  issueToken(input: {
    subject: string;
    issuedAt: number;
    expiresAt: number;
    issuer?: string;
    email?: string;
    sessionId?: string;
  }): Promise<string>;
}

export interface Clock {
  nowSeconds(): number;
}

export interface AuthSessionRepository {
  create(input: { id: string; userId: string; expiresAt: Date }): Promise<void>;
  extendExpiry(sessionId: string, expiresAt: Date): Promise<void>;
  revokeById(sessionId: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
  isActive(sessionId: string, now: Date): Promise<boolean>;
  isOwnedByUser?(
    sessionId: string,
    userId: string,
    now: Date,
  ): Promise<boolean>;
}

export interface PasswordResetTokenRepository {
  store(input: {
    hashedToken: string;
    email: string;
    expiresAt: Date;
  }): Promise<void>;
  findByHashedToken(
    hashedToken: string,
    now: Date,
  ): Promise<{ email: string } | null>;
  consumeByHashedToken(hashedToken: string): Promise<void>;
  deleteExpired(now: Date): Promise<void>;
}

export interface InvitationRepository {
  create(input: {
    id: string;
    hashedToken: string;
    email: string;
    name: string | null;
    invitedByUserId: string;
    expiresAt: Date;
  }): Promise<void>;
  findActiveByHashedToken(
    hashedToken: string,
    now: Date,
  ): Promise<{ id: string; email: string; name: string | null } | null>;
  findById(input: {
    id: string;
  }): Promise<{ id: string; email: string; name: string | null } | null>;
  listRecent(input: { limit: number }): Promise<
    {
      id: string;
      email: string;
      name: string | null;
      expiresAt: Date;
      acceptedAt: Date | null;
      revokedAt: Date | null;
      createdAt: Date;
    }[]
  >;
  revokeActiveByEmail(email: string, now: Date): Promise<void>;
  markAccepted(id: string, acceptedAt: Date): Promise<void>;
  deleteExpired(now: Date): Promise<void>;
}
