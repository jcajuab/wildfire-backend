import {
  buildRefreshTokenValue,
  createRefreshTokenSecret,
  hashRefreshTokenSecret,
  parseRefreshTokenValue,
} from "#/application/auth/refresh-token";
import {
  type AuthIdentityCache,
  type AuthSessionRepository,
  type Clock,
  type TokenIssuer,
} from "#/application/ports/auth";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import { InvalidCredentialsError } from "#/application/use-cases/auth/errors";
import { logger } from "#/infrastructure/observability/logger";

export interface RefreshSessionInput {
  refreshToken?: string;
  userId?: string;
  currentSessionId?: string;
  currentJti?: string;
}

export interface RefreshSessionResult {
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

interface RefreshSessionDeps {
  tokenIssuer: TokenIssuer;
  userRepository: UserRepository;
  authorizationRepository?: AuthorizationRepository;
  authIdentityCache?: AuthIdentityCache;
  clock: Clock;
  tokenTtlSeconds: number;
  refreshTokenTtlSeconds?: number;
  issuer?: string;
  authSessionRepository: AuthSessionRepository;
}

export class RefreshSessionUseCase {
  constructor(private readonly deps: RefreshSessionDeps) {}

  async execute(input: RefreshSessionInput): Promise<RefreshSessionResult> {
    let sessionLookupId: string | undefined;
    let presentedJti: string | undefined;

    if (typeof input.refreshToken === "string") {
      const parsedRefreshToken = parseRefreshTokenValue(input.refreshToken);
      if (!parsedRefreshToken) {
        throw new InvalidCredentialsError();
      }
      sessionLookupId = parsedRefreshToken.sessionId;
      presentedJti = hashRefreshTokenSecret(parsedRefreshToken.secret);
    } else {
      sessionLookupId = input.currentSessionId;
      presentedJti = input.currentJti;
    }

    if (!sessionLookupId) {
      throw new InvalidCredentialsError();
    }

    const session =
      await this.deps.authSessionRepository.findBySessionId(sessionLookupId);
    if (!session) {
      throw new InvalidCredentialsError();
    }

    const issuedAt = this.deps.clock.nowSeconds();
    const expiresAt = issuedAt + this.deps.tokenTtlSeconds;
    const refreshExpiresAt =
      issuedAt +
      (this.deps.refreshTokenTtlSeconds ?? this.deps.tokenTtlSeconds);
    const now = new Date(issuedAt * 1000);
    const newExpiresAt = new Date(refreshExpiresAt * 1000);
    const gracePreviousJtiExpiresAt = new Date(now.getTime() + 10_000);

    let nextRefreshSecret = createRefreshTokenSecret();
    let nextRefreshToken = buildRefreshTokenValue(
      session.id,
      nextRefreshSecret,
    );
    let nextRefreshTokenHash = hashRefreshTokenSecret(nextRefreshSecret);

    if (presentedJti === session.currentJti) {
      const updated =
        await this.deps.authSessionRepository.updateCurrentJtiOptimistic({
          sessionId: session.id,
          expectedCurrentJti: session.currentJti,
          newJti: nextRefreshTokenHash,
          previousJti: session.currentJti,
          previousJtiExpiresAt: gracePreviousJtiExpiresAt,
          newExpiresAt,
        });

      if (!updated) {
        const refreshed = await this.deps.authSessionRepository.findBySessionId(
          session.id,
        );
        if (
          refreshed &&
          refreshed.previousJti === presentedJti &&
          refreshed.previousJtiExpiresAt &&
          now < refreshed.previousJtiExpiresAt
        ) {
          nextRefreshSecret = createRefreshTokenSecret();
          nextRefreshToken = buildRefreshTokenValue(
            refreshed.id,
            nextRefreshSecret,
          );
          nextRefreshTokenHash = hashRefreshTokenSecret(nextRefreshSecret);
          const rotated =
            await this.deps.authSessionRepository.updateCurrentJtiOptimistic({
              sessionId: refreshed.id,
              expectedCurrentJti: refreshed.currentJti,
              newJti: nextRefreshTokenHash,
              previousJti: refreshed.currentJti,
              previousJtiExpiresAt: gracePreviousJtiExpiresAt,
              newExpiresAt,
            });
          if (!rotated) {
            throw new InvalidCredentialsError();
          }
        } else {
          throw new InvalidCredentialsError();
        }
      }
    } else if (
      presentedJti === session.previousJti &&
      session.previousJtiExpiresAt &&
      now < session.previousJtiExpiresAt
    ) {
      const updated =
        await this.deps.authSessionRepository.updateCurrentJtiOptimistic({
          sessionId: session.id,
          expectedCurrentJti: session.currentJti,
          newJti: nextRefreshTokenHash,
          previousJti: session.currentJti,
          previousJtiExpiresAt: gracePreviousJtiExpiresAt,
          newExpiresAt,
        });

      if (!updated) {
        const refreshed = await this.deps.authSessionRepository.findBySessionId(
          session.id,
        );
        if (!refreshed) {
          throw new InvalidCredentialsError();
        }

        nextRefreshSecret = createRefreshTokenSecret();
        nextRefreshToken = buildRefreshTokenValue(
          refreshed.id,
          nextRefreshSecret,
        );
        nextRefreshTokenHash = hashRefreshTokenSecret(nextRefreshSecret);
        const rotated =
          await this.deps.authSessionRepository.updateCurrentJtiOptimistic({
            sessionId: refreshed.id,
            expectedCurrentJti: refreshed.currentJti,
            newJti: nextRefreshTokenHash,
            previousJti: refreshed.currentJti,
            previousJtiExpiresAt: gracePreviousJtiExpiresAt,
            newExpiresAt,
          });
        if (!rotated) {
          throw new InvalidCredentialsError();
        }
      }
    } else if (
      presentedJti === session.previousJti &&
      session.previousJtiExpiresAt &&
      now >= session.previousJtiExpiresAt
    ) {
      const revokedCount =
        await this.deps.authSessionRepository.revokeByFamilyId(
          session.familyId,
        );
      logger.error(
        {
          event: "auth.session.family_revoked",
          familyId: session.familyId,
          revokedSessionCount: revokedCount,
          reason: "refresh_replay_after_grace",
        },
        "Session family revoked due to refresh token replay after grace window",
      );
      throw new InvalidCredentialsError();
    } else {
      const revokedCount =
        await this.deps.authSessionRepository.revokeByFamilyId(
          session.familyId,
        );
      logger.error(
        {
          event: "auth.session.family_revoked",
          familyId: session.familyId,
          revokedSessionCount: revokedCount,
          reason: "refresh_token_mismatch",
        },
        "Session family revoked due to refresh token mismatch",
      );
      throw new InvalidCredentialsError();
    }

    const existingUser = await this.deps.userRepository.findById(
      session.userId,
    );
    if (!existingUser) {
      throw new InvalidCredentialsError();
    }
    if (!existingUser.isActive) {
      throw new InvalidCredentialsError(
        "Your account is currently deactivated. Please contact your administrator.",
      );
    }
    if (existingUser.bannedAt != null) {
      throw new InvalidCredentialsError(
        "Your account has been suspended. Please contact your administrator.",
      );
    }

    const lastSeenAt = now.toISOString();
    const user =
      (await this.deps.userRepository.update(session.userId, {
        lastSeenAt,
      })) ?? existingUser;

    let isAdmin = false;
    let permissionStrings: string[] = [];

    if (this.deps.authorizationRepository) {
      const cached = this.deps.authIdentityCache
        ? await this.deps.authIdentityCache.getPermissions(user.id)
        : null;

      if (cached != null) {
        isAdmin = cached.isAdmin;
        permissionStrings = cached.permissions;
      } else {
        isAdmin = await this.deps.authorizationRepository.isAdminUser(user.id);
        permissionStrings = (
          await this.deps.authorizationRepository.findPermissionsForUser(
            user.id,
          )
        ).map((permission) => `${permission.resource}:${permission.action}`);

        if (this.deps.authIdentityCache) {
          await this.deps.authIdentityCache.setPermissions(
            user.id,
            { isAdmin, permissions: permissionStrings },
            60,
          );
        }
      }
    }

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
      refreshToken: nextRefreshToken,
      refreshTokenExpiresAt: newExpiresAt.toISOString(),
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
