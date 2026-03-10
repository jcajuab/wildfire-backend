import { type Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  type AuthSessionRepository,
  type Clock,
  type CredentialsRepository,
  type EmailChangeTokenRepository,
  type InvitationRepository,
  type PasswordHasher,
  type PasswordResetTokenRepository,
  type PasswordVerifier,
  type TokenIssuer,
} from "#/application/ports/auth";
import { type ContentStorage } from "#/application/ports/content";
import {
  type EmailChangeVerificationEmailSender,
  type InvitationEmailSender,
  type PasswordResetEmailSender,
} from "#/application/ports/notifications";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import {
  type AcceptInvitationUseCase,
  type AuthenticateUserUseCase,
  type ChangeCurrentUserPasswordUseCase,
  type CreateInvitationUseCase,
  type ForgotPasswordUseCase,
  type ListInvitationsUseCase,
  type RefreshSessionUseCase,
  type RequestEmailChangeUseCase,
  type ResendInvitationUseCase,
  type ResetPasswordUseCase,
  type SetCurrentUserAvatarUseCase,
  type UpdateCurrentUserProfileUseCase,
  type VerifyEmailChangeUseCase,
} from "#/application/use-cases/auth";
import {
  type CheckPermissionUseCase,
  type DeleteCurrentUserUseCase,
} from "#/application/use-cases/rbac";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { type AuthSecurityStore } from "#/interfaces/http/security/redis-auth-security.store";

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
  authSecurityStore: AuthSecurityStore;
  authLoginRateLimitMaxAttempts: number;
  authLoginRateLimitWindowSeconds: number;
  authLoginLockoutThreshold: number;
  authLoginLockoutSeconds: number;
  trustProxyHeaders: boolean;
  passwordResetTokenRepository: PasswordResetTokenRepository;
  emailChangeTokenRepository?: EmailChangeTokenRepository;
  invitationRepository: InvitationRepository;
  invitationEmailSender: InvitationEmailSender;
  includeDevelopmentInviteUrls: boolean;
  emailChangeVerificationEmailSender?: EmailChangeVerificationEmailSender;
  passwordResetEmailSender?: PasswordResetEmailSender;
  inviteTokenTtlSeconds: number;
  inviteAcceptBaseUrl: string;
  resetPasswordBaseUrl?: string;
  emailChangeTokenTtlSeconds?: number;
  emailChangeVerifyBaseUrl?: string;
  deleteCurrentUserUseCase: DeleteCurrentUserUseCase;
  updateCurrentUserProfileUseCase: UpdateCurrentUserProfileUseCase;
  changeCurrentUserPasswordUseCase: ChangeCurrentUserPasswordUseCase;
  setCurrentUserAvatarUseCase: SetCurrentUserAvatarUseCase;
  avatarStorage: ContentStorage;
  avatarUrlExpiresInSeconds: number;
  checkPermissionUseCase: CheckPermissionUseCase;
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
  requestEmailChange: RequestEmailChangeUseCase;
  verifyEmailChange: VerifyEmailChangeUseCase;
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
    username: z.string(),
    email: z.string().email().nullable(),
    pendingEmail: z.string().email().nullable().optional(),
    name: z.string(),
    isAdmin: z.boolean(),
    timezone: z.string().nullable().optional(),
    avatarUrl: z.string().url().optional(),
  }),
  permissions: z.array(z.string()),
});

type AuthResultUser = {
  id: string;
  username: string;
  email: string | null;
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

const enrichUserWithAvatarUrl = async (
  user: AuthResultUser,
  storage: ContentStorage,
  expiresInSeconds: number,
  isAdmin: boolean,
  pendingEmail: string | null,
): Promise<{
  id: string;
  username: string;
  email: string | null;
  pendingEmail: string | null;
  name: string;
  isAdmin: boolean;
  timezone?: string | null;
  avatarUrl?: string;
}> => {
  const base = {
    id: user.id,
    username: user.username,
    email: user.email,
    pendingEmail,
    name: user.name,
    isAdmin,
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
  const isAdmin = deps.authorizationRepository.isAdminUser
    ? await deps.authorizationRepository.isAdminUser(result.user.id)
    : false;
  const permissions = await deps.authorizationRepository.findPermissionsForUser(
    result.user.id,
  );
  const permissionStrings = permissions.map((p) => `${p.resource}:${p.action}`);
  const pendingEmailRecord = deps.emailChangeTokenRepository
    ? await deps.emailChangeTokenRepository.findPendingByUserId(
        result.user.id,
        new Date(),
      )
    : null;
  const user = await enrichUserWithAvatarUrl(
    result.user,
    deps.avatarStorage,
    deps.avatarUrlExpiresInSeconds,
    isAdmin,
    pendingEmailRecord?.email ?? null,
  );

  return {
    ...result,
    user,
    permissions: permissionStrings,
  };
};
