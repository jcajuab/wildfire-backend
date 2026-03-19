import { type Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  type AuthSessionRepository,
  type Clock,
  type CredentialsReader,
  type CredentialsRepository,
  type InvitationRepository,
  type PasswordHasher,
  type PasswordVerifier,
  type TokenIssuer,
} from "#/application/ports/auth";
import { type ContentStorage } from "#/application/ports/content";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import {
  type AcceptInvitationUseCase,
  type AuthenticateUserUseCase,
  type ChangeCurrentUserPasswordUseCase,
  type CreateInvitationUseCase,
  type ListInvitationsUseCase,
  type RefreshSessionUseCase,
  type ResendInvitationUseCase,
  type RevealInvitationLinkUseCase,
  type SetCurrentUserAvatarUseCase,
  type UpdateCurrentUserProfileUseCase,
} from "#/application/use-cases/auth";
import {
  type CheckPermissionUseCase,
  type DeleteCurrentUserUseCase,
} from "#/application/use-cases/rbac";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { type AuthSecurityStore } from "#/interfaces/http/security/redis-auth-security.store";
import { AVATAR_MAX_BYTES } from "#/interfaces/http/validators/auth.schema";

export interface AuthRouterDeps {
  /** Read-only htshadow credential lookup; Wildfire must not write to htshadow. */
  credentialsRepository: CredentialsReader;
  dbCredentialsRepository: CredentialsRepository;
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
  authSessionRateLimitMaxAttempts: number;
  authSessionRateLimitWindowSeconds: number;
  authLoginLockoutThreshold: number;
  authLoginLockoutSeconds: number;
  trustProxyHeaders: boolean;
  invitationRepository: InvitationRepository;
  includeDevelopmentInviteUrls: boolean;
  inviteTokenTtlSeconds: number;
  inviteAcceptBaseUrl: string;
  deleteCurrentUserUseCase: DeleteCurrentUserUseCase;
  updateCurrentUserProfileUseCase: UpdateCurrentUserProfileUseCase;
  changeCurrentUserPasswordUseCase: ChangeCurrentUserPasswordUseCase;
  setCurrentUserAvatarUseCase: SetCurrentUserAvatarUseCase;
  avatarStorage: ContentStorage;
  avatarUrlExpiresInSeconds: number;
  checkPermissionUseCase: CheckPermissionUseCase;
  secureCookies: boolean;
  csrfCookieName: string;
}

export interface AuthRouterUseCases {
  authenticateUser: AuthenticateUserUseCase;
  refreshSession: RefreshSessionUseCase;
  createInvitation: CreateInvitationUseCase;
  acceptInvitation: AcceptInvitationUseCase;
  listInvitations: ListInvitationsUseCase;
  resendInvitation: ResendInvitationUseCase;
  revealInvitationLink: RevealInvitationLinkUseCase;
}

export type AuthRouter = Hono<{ Variables: JwtUserVariables }>;

export type AuthMiddleware = MiddlewareHandler<{ Variables: JwtUserVariables }>;

export const authTags = ["Auth"];
export { AVATAR_MAX_BYTES };

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
    isInvitedUser: z.boolean(),
    timezone: z.string().nullable().optional(),
    avatarUrl: z.string().url().optional(),
  }),
  permissions: z.array(z.string()),
});

export const sessionResponseSchema = authResponseSchema.omit({ token: true });

type AuthResultUser = {
  id: string;
  username: string;
  email: string | null;
  name: string;
  timezone?: string | null;
  avatarKey?: string | null;
  invitedAt?: string | null;
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
  isInvitedUser: boolean,
  pendingEmail: string | null,
): Promise<{
  id: string;
  username: string;
  email: string | null;
  pendingEmail: string | null;
  name: string;
  isAdmin: boolean;
  isInvitedUser: boolean;
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
    isInvitedUser,
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
  const isAdmin = await deps.authorizationRepository.isAdminUser(
    result.user.id,
  );
  const permissions = await deps.authorizationRepository.findPermissionsForUser(
    result.user.id,
  );
  const permissionStrings = permissions.map((p) => `${p.resource}:${p.action}`);
  const isInvitedUser = result.user.invitedAt != null;
  const user = await enrichUserWithAvatarUrl(
    result.user,
    deps.avatarStorage,
    deps.avatarUrlExpiresInSeconds,
    isAdmin,
    isInvitedUser,
    null,
  );

  return {
    ...result,
    user,
    permissions: permissionStrings,
  };
};
