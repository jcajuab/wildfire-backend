import {
  type AuthSessionRepository,
  type Clock,
  type CredentialsRepository,
  type PasswordVerifier,
  type TokenIssuer,
} from "#/application/ports/auth";
import { type UserRepository } from "#/application/ports/rbac";
import { InvalidCredentialsError } from "#/application/use-cases/auth/errors";

export interface AuthenticateUserInput {
  username: string;
  password: string;
}

export interface AuthResult {
  type: "bearer";
  token: string;
  expiresAt: string;
  user: {
    id: string;
    username: string;
    email: string | null;
    name: string;
    timezone?: string | null;
    avatarKey?: string | null;
  };
}

interface AuthenticateUserDeps {
  credentialsRepository: CredentialsRepository;
  passwordVerifier: PasswordVerifier;
  tokenIssuer: TokenIssuer;
  userRepository: UserRepository;
  clock: Clock;
  tokenTtlSeconds: number;
  issuer?: string;
  authSessionRepository: AuthSessionRepository;
}

export class AuthenticateUserUseCase {
  constructor(private readonly deps: AuthenticateUserDeps) {}

  async execute(input: AuthenticateUserInput): Promise<AuthResult> {
    const username = input.username.trim().toLowerCase();
    const passwordHash =
      await this.deps.credentialsRepository.findPasswordHash(username);

    if (!passwordHash) {
      throw new InvalidCredentialsError();
    }

    const verified = await this.deps.passwordVerifier.verify({
      password: input.password,
      passwordHash,
    });

    if (!verified) {
      throw new InvalidCredentialsError();
    }

    const user = await this.deps.userRepository.findByUsername(username);
    if (!user) {
      throw new InvalidCredentialsError();
    }
    if (!user.isActive) {
      throw new InvalidCredentialsError(
        "Your account is currently deactivated. Please contact your administrator.",
      );
    }

    const issuedAt = this.deps.clock.nowSeconds();
    const expiresAt = issuedAt + this.deps.tokenTtlSeconds;
    const sessionId = crypto.randomUUID();
    await this.deps.authSessionRepository.create({
      id: sessionId,
      userId: user.id,
      expiresAt: new Date(expiresAt * 1000),
    });
    const token = await this.deps.tokenIssuer.issueToken({
      subject: user.id,
      issuedAt,
      expiresAt,
      issuer: this.deps.issuer,
      username: user.username,
      email: user.email ?? undefined,
      sessionId,
    });

    return {
      type: "bearer",
      token,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        timezone: user.timezone ?? null,
        avatarKey: user.avatarKey ?? null,
      },
    };
  }
}
