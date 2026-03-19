import {
  type AuthSessionRepository,
  type Clock,
  type TokenIssuer,
} from "#/application/ports/auth";
import { type UserRepository } from "#/application/ports/rbac";
import { InvalidCredentialsError } from "#/application/use-cases/auth/errors";

export interface RefreshSessionInput {
  userId: string;
  currentSessionId?: string;
  currentJti?: string;
}

export interface RefreshSessionResult {
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

interface RefreshSessionDeps {
  tokenIssuer: TokenIssuer;
  userRepository: UserRepository;
  clock: Clock;
  tokenTtlSeconds: number;
  issuer?: string;
  authSessionRepository: AuthSessionRepository;
}

export class RefreshSessionUseCase {
  constructor(private readonly deps: RefreshSessionDeps) {}

  async execute(input: RefreshSessionInput): Promise<RefreshSessionResult> {
    const existingUser = await this.deps.userRepository.findById(input.userId);
    if (!existingUser) {
      throw new InvalidCredentialsError();
    }
    if (!existingUser.isActive) {
      throw new InvalidCredentialsError(
        "Your account is currently deactivated. Please contact your administrator.",
      );
    }

    const issuedAt = this.deps.clock.nowSeconds();
    const expiresAt = issuedAt + this.deps.tokenTtlSeconds;
    const lastSeenAt = new Date(issuedAt * 1000).toISOString();
    const user =
      (await this.deps.userRepository.update(input.userId, {
        lastSeenAt,
      })) ?? existingUser;

    let sessionId: string;
    let newJti: string;

    if (input.currentSessionId) {
      const session = await this.deps.authSessionRepository.findBySessionId(
        input.currentSessionId,
      );
      if (!session) {
        throw new InvalidCredentialsError();
      }

      // Ownership check: userId from session must match input
      if (session.userId !== input.userId) {
        throw new InvalidCredentialsError();
      }

      const presentedJti = input.currentJti;
      const now = new Date(issuedAt * 1000);
      const newExpiresAt = new Date(expiresAt * 1000);
      const gracePreviousJtiExpiresAt = new Date(now.getTime() + 10_000);

      if (presentedJti === session.currentJti) {
        // Normal refresh: rotate jti
        newJti = crypto.randomUUID();
        const updated =
          await this.deps.authSessionRepository.updateCurrentJtiOptimistic({
            sessionId: input.currentSessionId,
            expectedCurrentJti: session.currentJti,
            newJti,
            previousJti: session.currentJti,
            previousJtiExpiresAt: gracePreviousJtiExpiresAt,
            newExpiresAt,
          });

        if (!updated) {
          // Concurrent refresh: re-read and converge
          const refreshed =
            await this.deps.authSessionRepository.findBySessionId(
              input.currentSessionId,
            );
          if (
            refreshed &&
            refreshed.previousJti === presentedJti &&
            refreshed.previousJtiExpiresAt &&
            now < refreshed.previousJtiExpiresAt
          ) {
            // Another tab already rotated, converge to new jti
            newJti = refreshed.currentJti;
          } else {
            throw new InvalidCredentialsError();
          }
        }
      } else if (
        presentedJti &&
        presentedJti === session.previousJti &&
        session.previousJtiExpiresAt &&
        now < session.previousJtiExpiresAt
      ) {
        // Grace window: benign race (another tab already refreshed)
        newJti = crypto.randomUUID();
        const updated =
          await this.deps.authSessionRepository.updateCurrentJtiOptimistic({
            sessionId: input.currentSessionId,
            expectedCurrentJti: session.currentJti,
            newJti,
            previousJti: session.currentJti,
            previousJtiExpiresAt: gracePreviousJtiExpiresAt,
            newExpiresAt,
          });

        if (!updated) {
          // Another concurrent update happened; re-read and converge
          const refreshed =
            await this.deps.authSessionRepository.findBySessionId(
              input.currentSessionId,
            );
          if (refreshed) {
            newJti = refreshed.currentJti;
          } else {
            throw new InvalidCredentialsError();
          }
        }
      } else if (
        presentedJti &&
        presentedJti === session.previousJti &&
        session.previousJtiExpiresAt &&
        now >= session.previousJtiExpiresAt
      ) {
        // Replay attack after grace window
        const revokedCount =
          await this.deps.authSessionRepository.revokeByFamilyId(
            session.familyId,
          );
        console.error(
          JSON.stringify({
            event: "auth.session.family_revoked",
            familyId: session.familyId,
            triggeredByJti: presentedJti,
            revokedSessionCount: revokedCount,
            reason: "replay_after_grace",
          }),
        );
        throw new InvalidCredentialsError();
      } else if (presentedJti) {
        // Unknown jti: replay attack
        const revokedCount =
          await this.deps.authSessionRepository.revokeByFamilyId(
            session.familyId,
          );
        console.error(
          JSON.stringify({
            event: "auth.session.family_revoked",
            familyId: session.familyId,
            triggeredByJti: presentedJti,
            revokedSessionCount: revokedCount,
            reason: "jti_mismatch",
          }),
        );
        throw new InvalidCredentialsError();
      } else {
        // No jti presented: extend session without jti rotation (legacy path with sessionId)
        await this.deps.authSessionRepository.extendExpiry(
          input.currentSessionId,
          newExpiresAt,
        );
        newJti = session.currentJti;
      }

      sessionId = input.currentSessionId;
    } else {
      // No currentSessionId: create fresh session
      sessionId = crypto.randomUUID();
      newJti = crypto.randomUUID();
      await this.deps.authSessionRepository.create({
        id: sessionId,
        userId: user.id,
        expiresAt: new Date(expiresAt * 1000),
        familyId: crypto.randomUUID(),
        currentJti: newJti,
      });
    }

    const token = await this.deps.tokenIssuer.issueToken({
      subject: user.id,
      issuedAt,
      expiresAt,
      issuer: this.deps.issuer,
      username: user.username,
      email: user.email ?? undefined,
      sessionId,
      jti: newJti,
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
