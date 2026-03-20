/**
 * Read-only credential lookup (e.g. htshadow). Wildfire must not write to htshadow.
 */
export interface CredentialsReader {
  findPasswordHash(username: string): Promise<string | null>;
}

export interface CredentialsRepository extends CredentialsReader {
  updatePasswordHash(username: string, newPasswordHash: string): Promise<void>;
  createPasswordHash(username: string, passwordHash: string): Promise<void>;
  listUserIdsWithPasswordHash(): Promise<string[]>;
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
    username?: string;
    email?: string;
    sessionId?: string;
    jti?: string;
    isInvitedUser?: boolean;
  }): Promise<string>;
}

export interface Clock {
  nowSeconds(): number;
}

export interface AuthSessionRepository {
  create(input: {
    id: string;
    userId: string;
    expiresAt: Date;
    familyId: string;
    currentJti: string;
  }): Promise<void>;
  extendExpiry(sessionId: string, expiresAt: Date): Promise<void>;
  revokeById(sessionId: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
  isActive(sessionId: string, now: Date): Promise<boolean>;
  isOwnedByUser(sessionId: string, userId: string, now: Date): Promise<boolean>;
  findBySessionId(sessionId: string): Promise<{
    id: string;
    userId: string;
    familyId: string;
    currentJti: string;
    previousJti: string | null;
    previousJtiExpiresAt: Date | null;
    expiresAt: Date;
  } | null>;
  updateCurrentJtiOptimistic(input: {
    sessionId: string;
    expectedCurrentJti: string;
    newJti: string;
    previousJti: string;
    previousJtiExpiresAt: Date;
    newExpiresAt: Date;
  }): Promise<boolean>;
  revokeByFamilyId(familyId: string): Promise<number>;
}

export interface InvitationRepository {
  create(input: {
    id: string;
    hashedToken: string;
    email: string;
    name: string | null;
    invitedByUserId: string;
    expiresAt: Date;
    encryptedToken?: string | null;
    tokenIv?: string | null;
    tokenAuthTag?: string | null;
  }): Promise<void>;
  findEncryptedTokenById(
    id: string,
    now: Date,
  ): Promise<{
    encryptedToken: string;
    tokenIv: string;
    tokenAuthTag: string;
  } | null>;
  findActiveByHashedToken(
    hashedToken: string,
    now: Date,
  ): Promise<{ id: string; email: string; name: string | null } | null>;
  findById(input: {
    id: string;
  }): Promise<{ id: string; email: string; name: string | null } | null>;
  countAll(): Promise<number>;
  listPage(input: { page: number; pageSize: number }): Promise<
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
