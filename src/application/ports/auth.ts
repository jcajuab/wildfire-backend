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
  }): Promise<string>;
}

export interface Clock {
  nowSeconds(): number;
}
