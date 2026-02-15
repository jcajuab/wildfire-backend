import { type Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  type Clock,
  type CredentialsRepository,
  type PasswordVerifier,
  type TokenIssuer,
} from "#/application/ports/auth";
import { type ContentStorage } from "#/application/ports/content";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import {
  AuthenticateUserUseCase,
  type ChangeCurrentUserPasswordUseCase,
  RefreshSessionUseCase,
  type SetCurrentUserAvatarUseCase,
  type UpdateCurrentUserProfileUseCase,
} from "#/application/use-cases/auth";
import { type DeleteCurrentUserUseCase } from "#/application/use-cases/rbac";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";

export interface AuthRouterDeps {
  credentialsRepository: CredentialsRepository;
  passwordVerifier: PasswordVerifier;
  tokenIssuer: TokenIssuer;
  userRepository: UserRepository;
  authorizationRepository: AuthorizationRepository;
  clock: Clock;
  tokenTtlSeconds: number;
  issuer?: string;
  jwtSecret: string;
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
): AuthRouterUseCases => ({
  authenticateUser: new AuthenticateUserUseCase({
    credentialsRepository: deps.credentialsRepository,
    passwordVerifier: deps.passwordVerifier,
    tokenIssuer: deps.tokenIssuer,
    userRepository: deps.userRepository,
    clock: deps.clock,
    tokenTtlSeconds: deps.tokenTtlSeconds,
    issuer: deps.issuer,
  }),
  refreshSession: new RefreshSessionUseCase({
    tokenIssuer: deps.tokenIssuer,
    userRepository: deps.userRepository,
    clock: deps.clock,
    tokenTtlSeconds: deps.tokenTtlSeconds,
    issuer: deps.issuer,
  }),
});

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
