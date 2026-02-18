import { type Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  type AuthSessionRepository,
  type Clock,
  type CredentialsRepository,
  type InvitationRepository,
  type PasswordHasher,
  type PasswordResetTokenRepository,
  type PasswordVerifier,
  type TokenIssuer,
} from "#/application/ports/auth";
import { type ContentStorage } from "#/application/ports/content";
import { type InvitationEmailSender } from "#/application/ports/notifications";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import {
  AcceptInvitationUseCase,
  AuthenticateUserUseCase,
  type ChangeCurrentUserPasswordUseCase,
  CreateInvitationUseCase,
  ForgotPasswordUseCase,
  ListInvitationsUseCase,
  RefreshSessionUseCase,
  ResendInvitationUseCase,
  ResetPasswordUseCase,
  type SetCurrentUserAvatarUseCase,
  type UpdateCurrentUserProfileUseCase,
} from "#/application/use-cases/auth";
import { type DeleteCurrentUserUseCase } from "#/application/use-cases/rbac";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { type InMemoryAuthSecurityStore } from "#/interfaces/http/security/in-memory-auth-security.store";

export interface AuthRouterDeps {
  credentialsRepository: CredentialsRepository;
  passwordVerifier: PasswordVerifier;
  passwordHasher: PasswordHasher;
  tokenIssuer: TokenIssuer;
  userRepository: UserRepository;
  authorizationRepository: AuthorizationRepository;
  clock: Clock;
  tokenTtlSeconds: number;
  issuer?: string;
  jwtSecret: string;
  authSessionRepository: AuthSessionRepository;
  authSessionCookieName: string;
  authSessionDualMode: boolean;
  authSecurityStore: InMemoryAuthSecurityStore;
  authLoginRateLimitMaxAttempts: number;
  authLoginRateLimitWindowSeconds: number;
  authLoginLockoutThreshold: number;
  authLoginLockoutSeconds: number;
  passwordResetTokenRepository: PasswordResetTokenRepository;
  invitationRepository: InvitationRepository;
  invitationEmailSender: InvitationEmailSender;
  inviteTokenTtlSeconds: number;
  inviteAcceptBaseUrl: string;
  deleteCurrentUserUseCase: DeleteCurrentUserUseCase;
  updateCurrentUserProfileUseCase: UpdateCurrentUserProfileUseCase;
  changeCurrentUserPasswordUseCase: ChangeCurrentUserPasswordUseCase;
  setCurrentUserAvatarUseCase: SetCurrentUserAvatarUseCase;
  avatarStorage: ContentStorage;
  avatarUrlExpiresInSeconds: number;
}

export interface AuthRouterUseCases {
  authenticateUser: AuthenticateUserUseCase;
  refreshSession: RefreshSessionUseCase;
  forgotPassword: ForgotPasswordUseCase;
  resetPassword: ResetPasswordUseCase;
  createInvitation: CreateInvitationUseCase;
  acceptInvitation: AcceptInvitationUseCase;
  listInvitations: ListInvitationsUseCase;
  resendInvitation: ResendInvitationUseCase;
}

export type AuthRouter = Hono<{ Variables: JwtUserVariables }>;

export type AuthMiddleware = MiddlewareHandler<{ Variables: JwtUserVariables }>;

export const authTags = ["Auth"];
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export const authResponseSchema = z.object({
  type: z.literal("bearer"),
  token: z.string(),
  expiresAt: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    name: z.string(),
    timezone: z.string().nullable().optional(),
    avatarUrl: z.string().url().optional(),
  }),
  permissions: z.array(z.string()),
});

type AuthResultUser = {
  id: string;
  email: string;
  name: string;
  timezone?: string | null;
  avatarKey?: string | null;
};

type AuthResultBase = {
  type: "bearer";
  token: string;
  expiresAt: string;
  user: AuthResultUser;
};

export const createAuthUseCases = (
  deps: AuthRouterDeps,
): AuthRouterUseCases => {
  const createInvitation = new CreateInvitationUseCase({
    userRepository: deps.userRepository,
    invitationRepository: deps.invitationRepository,
    invitationEmailSender: deps.invitationEmailSender,
    inviteTokenTtlSeconds: deps.inviteTokenTtlSeconds,
    inviteAcceptBaseUrl: deps.inviteAcceptBaseUrl,
  });

  return {
    authenticateUser: new AuthenticateUserUseCase({
      credentialsRepository: deps.credentialsRepository,
      passwordVerifier: deps.passwordVerifier,
      tokenIssuer: deps.tokenIssuer,
      userRepository: deps.userRepository,
      clock: deps.clock,
      tokenTtlSeconds: deps.tokenTtlSeconds,
      issuer: deps.issuer,
      authSessionRepository: deps.authSessionRepository,
    }),
    refreshSession: new RefreshSessionUseCase({
      tokenIssuer: deps.tokenIssuer,
      userRepository: deps.userRepository,
      clock: deps.clock,
      tokenTtlSeconds: deps.tokenTtlSeconds,
      issuer: deps.issuer,
      authSessionRepository: deps.authSessionRepository,
    }),
    forgotPassword: new ForgotPasswordUseCase({
      userRepository: deps.userRepository,
      passwordResetTokenRepository: deps.passwordResetTokenRepository,
    }),
    resetPassword: new ResetPasswordUseCase({
      passwordResetTokenRepository: deps.passwordResetTokenRepository,
      credentialsRepository: deps.credentialsRepository,
      passwordHasher: deps.passwordHasher,
      userRepository: deps.userRepository,
      authSessionRepository: deps.authSessionRepository,
    }),
    createInvitation,
    acceptInvitation: new AcceptInvitationUseCase({
      invitationRepository: deps.invitationRepository,
      userRepository: deps.userRepository,
      passwordHasher: deps.passwordHasher,
      credentialsRepository: deps.credentialsRepository,
    }),
    listInvitations: new ListInvitationsUseCase({
      invitationRepository: deps.invitationRepository,
    }),
    resendInvitation: new ResendInvitationUseCase({
      invitationRepository: deps.invitationRepository,
      createInvitationUseCase: createInvitation,
    }),
  };
};

const enrichUserWithAvatarUrl = async (
  user: AuthResultUser,
  storage: ContentStorage,
  expiresInSeconds: number,
): Promise<{
  id: string;
  email: string;
  name: string;
  timezone?: string | null;
  avatarUrl?: string;
}> => {
  const base = {
    id: user.id,
    email: user.email,
    name: user.name,
    timezone: user.timezone ?? null,
  };

  if (!user.avatarKey) {
    return base;
  }

  const avatarUrl = await storage.getPresignedDownloadUrl({
    key: user.avatarKey,
    expiresInSeconds,
  });

  return { ...base, avatarUrl };
};

export const buildAuthResponse = async (
  deps: AuthRouterDeps,
  result: AuthResultBase,
) => {
  const permissions = await deps.authorizationRepository.findPermissionsForUser(
    result.user.id,
  );
  const permissionStrings = permissions.map((p) => `${p.resource}:${p.action}`);
  const user = await enrichUserWithAvatarUrl(
    result.user,
    deps.avatarStorage,
    deps.avatarUrlExpiresInSeconds,
  );

  return {
    ...result,
    user,
    permissions: permissionStrings,
  };
};
