import { type Hono, type MiddlewareHandler } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
import {
  type ContentMetadataExtractor,
  type ContentRepository,
  type ContentStorage,
  type ContentThumbnailGenerator,
} from "#/application/ports/content";
import {
  type ContentIngestionJobRepository,
  type ContentIngestionQueue,
  type ContentJobEventPublisher,
} from "#/application/ports/content-jobs";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import {
  DeleteContentUseCase,
  GetContentDownloadUrlUseCase,
  GetContentJobUseCase,
  GetContentUseCase,
  ListContentUseCase,
  ReplaceContentFileUseCase,
  SetContentExclusionUseCase,
  UpdateContentUseCase,
  UploadContentUseCase,
} from "#/application/use-cases/content";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { publishContentJobEvent } from "./jobs-stream";

export interface ContentRouterDeps {
  jwtSecret: string;
  authSessionRepository: AuthSessionRepository;
  authSessionCookieName: string;
  maxUploadBytes: number;
  downloadUrlExpiresInSeconds: number;
  thumbnailUrlExpiresInSeconds: number;
  repositories: {
    contentRepository: ContentRepository;
    contentIngestionJobRepository: ContentIngestionJobRepository;
    userRepository: UserRepository;
    authorizationRepository: AuthorizationRepository;
  };
  storage: ContentStorage;
  contentIngestionQueue: ContentIngestionQueue;
  contentMetadataExtractor: ContentMetadataExtractor;
  contentThumbnailGenerator: ContentThumbnailGenerator;
}

export interface ContentRouterUseCases {
  uploadContent: UploadContentUseCase;
  replaceContentFile: ReplaceContentFileUseCase;
  listContent: ListContentUseCase;
  getContent: GetContentUseCase;
  getContentJob: GetContentJobUseCase;
  updateContent: UpdateContentUseCase;
  setContentExclusion: SetContentExclusionUseCase;
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
  const contentJobEventPublisher: ContentJobEventPublisher = {
    publish(event) {
      publishContentJobEvent(event);
    },
  };

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
        addErrorContext(
          {
            component: "content",
            event: "content.cleanup.failed",
            route: input.route,
            contentId: input.contentId,
            fileKey: input.fileKey,
            failurePhase: input.failurePhase,
          },
          input.error,
        ),
        "content storage cleanup failed",
      );
    },
  };

  return {
    uploadContent: new UploadContentUseCase({
      contentRepository: deps.repositories.contentRepository,
      contentStorage: deps.storage,
      contentIngestionJobRepository:
        deps.repositories.contentIngestionJobRepository,
      contentIngestionQueue: deps.contentIngestionQueue,
      contentJobEventPublisher,
      userRepository: deps.repositories.userRepository,
    }),
    replaceContentFile: new ReplaceContentFileUseCase({
      contentRepository: deps.repositories.contentRepository,
      contentStorage: deps.storage,
      contentIngestionJobRepository:
        deps.repositories.contentIngestionJobRepository,
      contentIngestionQueue: deps.contentIngestionQueue,
      contentJobEventPublisher,
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
    getContentJob: new GetContentJobUseCase({
      contentIngestionJobRepository:
        deps.repositories.contentIngestionJobRepository,
    }),
    updateContent: new UpdateContentUseCase({
      contentRepository: deps.repositories.contentRepository,
      userRepository: deps.repositories.userRepository,
    }),
    setContentExclusion: new SetContentExclusionUseCase({
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
