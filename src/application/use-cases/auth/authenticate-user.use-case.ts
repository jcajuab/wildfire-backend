import {
  buildRefreshTokenValue,
  createRefreshTokenSecret,
  hashRefreshTokenSecret,
} from "#/application/auth/refresh-token";
import { isDcismUser } from "#/application/guards/dcism-user.guard";
import {
  type AuthSessionRepository,
  type Clock,
  type CredentialsReader,
  type CredentialsRepository,
  type PasswordVerifier,
  type TokenIssuer,
} from "#/application/ports/auth";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import { InvalidCredentialsError } from "#/application/use-cases/auth/errors";

export interface AuthenticateUserInput {
  username: string;
  password: string;
}

export interface AuthResult {
  type: "bearer";
  token?: string;
  expiresAt?: string;
  accessToken?: string;
  accessTokenExpiresAt?: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
  user: {
    id: string;
    username: string;
    email: string | null;
    name: string;
    timezone?: string | null;
    avatarKey?: string | null;
    invitedAt?: string | null;
    isAdmin?: boolean;
    isInvitedUser?: boolean;
  };
  permissions?: string[];
}

interface AuthenticateUserDeps {
  dbCredentialsRepository: CredentialsRepository;
  htshadowCredentialsReader: CredentialsReader;
  passwordVerifier: PasswordVerifier;
  tokenIssuer: TokenIssuer;
  userRepository: UserRepository;
  authorizationRepository: AuthorizationRepository;
  clock: Clock;
  tokenTtlSeconds: number;
  refreshTokenTtlSeconds?: number;
  issuer?: string;
  authSessionRepository: AuthSessionRepository;
}

export class AuthenticateUserUseCase {
  constructor(private readonly deps: AuthenticateUserDeps) {}

  async execute(input: AuthenticateUserInput): Promise<AuthResult> {
    const username = input.username.trim().toLowerCase();

    const user = await this.deps.userRepository.findByUsername(username);
    if (!user) {
      throw new InvalidCredentialsError();
    }

    const isAdmin = await this.deps.authorizationRepository.isAdminUser(
      user.id,
    );
    const dcism = isDcismUser({ ...user, isAdmin });

    const credentialsReader = dcism
      ? this.deps.htshadowCredentialsReader
      : this.deps.dbCredentialsRepository;

    const passwordHash = await credentialsReader.findPasswordHash(username);
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

    if (!user.isActive) {
      throw new InvalidCredentialsError(
        "Your account is currently deactivated. Please contact your administrator.",
      );
    }
    if (user.bannedAt != null) {
      throw new InvalidCredentialsError(
        "Your account has been suspended. Please contact your administrator.",
      );
    }

    const issuedAt = this.deps.clock.nowSeconds();
    const expiresAt = issuedAt + this.deps.tokenTtlSeconds;
    const refreshExpiresAt =
      issuedAt +
      (this.deps.refreshTokenTtlSeconds ?? this.deps.tokenTtlSeconds);
    const sessionId = crypto.randomUUID();
    const familyId = crypto.randomUUID();
    const refreshSecret = createRefreshTokenSecret();
    const refreshToken = buildRefreshTokenValue(sessionId, refreshSecret);

    const [permissions] = await Promise.all([
      this.deps.authorizationRepository.findPermissionsForUser(user.id),
      this.deps.authSessionRepository.create({
        id: sessionId,
        userId: user.id,
        expiresAt: new Date(refreshExpiresAt * 1000),
        familyId,
        currentJti: hashRefreshTokenSecret(refreshSecret),
      }),
    ]);
    const permissionStrings = permissions.map(
      (permission) => `${permission.resource}:${permission.action}`,
    );
    const accessToken = await this.deps.tokenIssuer.issueToken({
      subject: user.id,
      issuedAt,
      expiresAt,
      issuer: this.deps.issuer,
      username: user.username,
      email: user.email ?? undefined,
      name: user.name,
      timezone: user.timezone ?? null,
      isAdmin,
      isInvitedUser: user.invitedAt != null,
      permissions: permissionStrings,
    });

    return {
      type: "bearer",
      token: accessToken,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      accessToken,
      accessTokenExpiresAt: new Date(expiresAt * 1000).toISOString(),
      refreshToken,
      refreshTokenExpiresAt: new Date(refreshExpiresAt * 1000).toISOString(),
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        timezone: user.timezone ?? null,
        avatarKey: user.avatarKey ?? null,
        invitedAt: user.invitedAt ?? null,
        isAdmin,
        isInvitedUser: user.invitedAt != null,
      },
      permissions: permissionStrings,
    };
  }
}
