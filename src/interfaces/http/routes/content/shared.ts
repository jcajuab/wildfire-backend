import { type Hono, type MiddlewareHandler } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
import {
  type ContentMetadataExtractor,
  type ContentRepository,
  type ContentStorage,
  type ContentThumbnailGenerator,
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
  ReplaceContentFileUseCase,
  UpdateContentUseCase,
  UploadContentUseCase,
} from "#/application/use-cases/content";
import { logger } from "#/infrastructure/observability/logger";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";

export interface ContentRouterDeps {
  jwtSecret: string;
  authSessionRepository?: AuthSessionRepository;
  authSessionCookieName?: string;
  authSessionDualMode?: boolean;
  maxUploadBytes: number;
  downloadUrlExpiresInSeconds: number;
  thumbnailUrlExpiresInSeconds: number;
  repositories: {
    contentRepository: ContentRepository;
    userRepository: UserRepository;
    authorizationRepository: AuthorizationRepository;
  };
  storage: ContentStorage;
  contentMetadataExtractor: ContentMetadataExtractor;
  contentThumbnailGenerator: ContentThumbnailGenerator;
}

export interface ContentRouterUseCases {
  uploadContent: UploadContentUseCase;
  replaceContentFile: ReplaceContentFileUseCase;
  listContent: ListContentUseCase;
  getContent: GetContentUseCase;
  updateContent: UpdateContentUseCase;
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
): ContentRouterUseCases => {
  const cleanupFailureLogger = {
    logContentCleanupFailure(input: {
      route: string;
      contentId: string;
      fileKey: string;
      failurePhase:
        | "upload_rollback_delete"
        | "delete_after_metadata_remove"
        | "replace_cleanup_delete";
      error: unknown;
    }) {
      logger.error(
        {
          route: input.route,
          contentId: input.contentId,
          fileKey: input.fileKey,
          failurePhase: input.failurePhase,
          err: input.error,
        },
        "content storage cleanup failed",
      );
    },
  };

  return {
    uploadContent: new UploadContentUseCase({
      contentRepository: deps.repositories.contentRepository,
      contentStorage: deps.storage,
      contentMetadataExtractor: deps.contentMetadataExtractor,
      contentThumbnailGenerator: deps.contentThumbnailGenerator,
      userRepository: deps.repositories.userRepository,
      cleanupFailureLogger,
    }),
    replaceContentFile: new ReplaceContentFileUseCase({
      contentRepository: deps.repositories.contentRepository,
      contentStorage: deps.storage,
      contentMetadataExtractor: deps.contentMetadataExtractor,
      contentThumbnailGenerator: deps.contentThumbnailGenerator,
      userRepository: deps.repositories.userRepository,
      cleanupFailureLogger,
    }),
    listContent: new ListContentUseCase({
      contentRepository: deps.repositories.contentRepository,
      userRepository: deps.repositories.userRepository,
      contentStorage: deps.storage,
      thumbnailUrlExpiresInSeconds: deps.thumbnailUrlExpiresInSeconds,
    }),
    getContent: new GetContentUseCase({
      contentRepository: deps.repositories.contentRepository,
      userRepository: deps.repositories.userRepository,
      contentStorage: deps.storage,
      thumbnailUrlExpiresInSeconds: deps.thumbnailUrlExpiresInSeconds,
    }),
    updateContent: new UpdateContentUseCase({
      contentRepository: deps.repositories.contentRepository,
      userRepository: deps.repositories.userRepository,
    }),
    deleteContent: new DeleteContentUseCase({
      contentRepository: deps.repositories.contentRepository,
      contentStorage: deps.storage,
      cleanupFailureLogger,
    }),
    getDownloadUrl: new GetContentDownloadUrlUseCase({
      contentRepository: deps.repositories.contentRepository,
      contentStorage: deps.storage,
      expiresInSeconds: deps.downloadUrlExpiresInSeconds,
    }),
  };
};
