import { type Hono } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
import { type AuthorizationRepository } from "#/application/ports/rbac";
import {
  type AIChatUseCase,
  type DeleteAICredentialUseCase,
  type ListAICredentialsUseCase,
  type StoreAICredentialUseCase,
} from "#/application/use-cases/ai";
import { type CheckPermissionUseCase } from "#/application/use-cases/rbac";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { type AuthorizePermission } from "#/interfaces/http/routes/shared/error-handling";

export interface AIRouterDeps {
  jwtSecret: string;
  authSessionRepository: AuthSessionRepository;
  authSessionCookieName: string;
  repositories: {
    authorizationRepository: AuthorizationRepository;
  };
  checkPermissionUseCase: CheckPermissionUseCase;
  rateLimitWindowSeconds: number;
  rateLimitMaxRequests: number;
}

export interface AIRouterUseCases {
  aiChat: AIChatUseCase;
  storeCredential: StoreAICredentialUseCase;
  listCredentials: ListAICredentialsUseCase;
  deleteCredential: DeleteAICredentialUseCase;
}

export type AIRouter = Hono<{ Variables: JwtUserVariables }>;

export type { AuthorizePermission };

export const aiTags = ["AI"];
