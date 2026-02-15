import { type Hono, type MiddlewareHandler } from "hono";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import {
  DeleteContentUseCase,
  GetContentDownloadUrlUseCase,
  GetContentUseCase,
  ListContentUseCase,
  UploadContentUseCase,
} from "#/application/use-cases/content";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";

export interface ContentRouterDeps {
  jwtSecret: string;
  maxUploadBytes: number;
  downloadUrlExpiresInSeconds: number;
  repositories: {
    contentRepository: ContentRepository;
    userRepository: UserRepository;
    authorizationRepository: AuthorizationRepository;
  };
  storage: ContentStorage;
}

export interface ContentRouterUseCases {
  uploadContent: UploadContentUseCase;
  listContent: ListContentUseCase;
  getContent: GetContentUseCase;
  deleteContent: DeleteContentUseCase;
  getDownloadUrl: GetContentDownloadUrlUseCase;
}

export type ContentRouter = Hono<{ Variables: JwtUserVariables }>;

export type RequirePermission = (
  permission: string,
) => MiddlewareHandler<{ Variables: JwtUserVariables }>;

export const contentTags = ["Content"];

export const createContentUseCases = (
  deps: ContentRouterDeps,
): ContentRouterUseCases => ({
  uploadContent: new UploadContentUseCase({
    contentRepository: deps.repositories.contentRepository,
    contentStorage: deps.storage,
    userRepository: deps.repositories.userRepository,
  }),
  listContent: new ListContentUseCase({
    contentRepository: deps.repositories.contentRepository,
    userRepository: deps.repositories.userRepository,
  }),
  getContent: new GetContentUseCase({
    contentRepository: deps.repositories.contentRepository,
    userRepository: deps.repositories.userRepository,
  }),
  deleteContent: new DeleteContentUseCase({
    contentRepository: deps.repositories.contentRepository,
    contentStorage: deps.storage,
  }),
  getDownloadUrl: new GetContentDownloadUrlUseCase({
    contentRepository: deps.repositories.contentRepository,
    contentStorage: deps.storage,
    expiresInSeconds: deps.downloadUrlExpiresInSeconds,
  }),
});
