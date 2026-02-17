export interface CredentialsRepository {
  findPasswordHash(username: string): Promise<string | null>;
  updatePasswordHash(email: string, newPasswordHash: string): Promise<void>;
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
  revokeById(sessionId: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
  isActive(sessionId: string, now: Date): Promise<boolean>;
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
