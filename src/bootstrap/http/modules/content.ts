import { ContentPlaylistReportingService } from "#/application/reporting/content-playlist-reporting";
import {
  CancelPdfCropUseCase,
  CreateFlashContentUseCase,
  CreateTextContentUseCase,
  DeleteContentUseCase,
  GetContentDownloadUrlUseCase,
  GetContentJobUseCase,
  GetContentUseCase,
  InitPdfCropUseCase,
  ListContentOptionsUseCase,
  ListContentUseCase,
  ReplaceContentFileUseCase,
  SubmitPdfCropUseCase,
  UpdateContentUseCase,
  UploadContentUseCase,
} from "#/application/use-cases/content";
import { CheckPermissionUseCase } from "#/application/use-cases/rbac";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import {
  type ContentRouterDeps,
  type ContentRouterUseCases,
} from "#/interfaces/http/routes/content/shared";

export interface ContentHttpModule {
  deps: ContentRouterDeps;
  useCases: ContentRouterUseCases;
}

export const createContentHttpModule = (
  deps: Omit<ContentRouterDeps, "checkPermissionUseCase">,
): ContentHttpModule => {
  const routerDeps: ContentRouterDeps = {
    ...deps,
    checkPermissionUseCase: new CheckPermissionUseCase({
      authorizationRepository: deps.repositories.authorizationRepository,
    }),
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

  const contentPlaylistReportingService = new ContentPlaylistReportingService();

  return {
    deps: routerDeps,
    useCases: {
      uploadContent: new UploadContentUseCase({
        contentRepository: routerDeps.repositories.contentRepository,
        contentStorage: routerDeps.storage,
        contentIngestionJobRepository:
          routerDeps.repositories.contentIngestionJobRepository,
        contentIngestionQueue: routerDeps.contentIngestionQueue,
        contentJobEventPublisher: routerDeps.contentJobEventPublisher,
        userRepository: routerDeps.repositories.userRepository,
      }),
      replaceContentFile: new ReplaceContentFileUseCase({
        contentRepository: routerDeps.repositories.contentRepository,
        contentStorage: routerDeps.storage,
        contentIngestionJobRepository:
          routerDeps.repositories.contentIngestionJobRepository,
        contentIngestionQueue: routerDeps.contentIngestionQueue,
        contentJobEventPublisher: routerDeps.contentJobEventPublisher,
        userRepository: routerDeps.repositories.userRepository,
        cleanupFailureLogger,
        contentPlaylistReportingService,
      }),
      listContent: new ListContentUseCase({
        contentRepository: routerDeps.repositories.contentRepository,
        userRepository: routerDeps.repositories.userRepository,
        contentStorage: routerDeps.storage,
        thumbnailUrlExpiresInSeconds: routerDeps.thumbnailUrlExpiresInSeconds,
      }),
      listContentOptions: new ListContentOptionsUseCase({
        contentRepository: routerDeps.repositories.contentRepository,
      }),
      getContent: new GetContentUseCase({
        contentRepository: routerDeps.repositories.contentRepository,
        userRepository: routerDeps.repositories.userRepository,
        contentStorage: routerDeps.storage,
        thumbnailUrlExpiresInSeconds: routerDeps.thumbnailUrlExpiresInSeconds,
      }),
      getContentJob: new GetContentJobUseCase({
        contentIngestionJobRepository:
          routerDeps.repositories.contentIngestionJobRepository,
      }),
      createFlashContent: new CreateFlashContentUseCase({
        contentRepository: routerDeps.repositories.contentRepository,
        contentStorage: routerDeps.storage,
        userRepository: routerDeps.repositories.userRepository,
      }),
      createTextContent: new CreateTextContentUseCase({
        contentRepository: routerDeps.repositories.contentRepository,
        contentStorage: routerDeps.storage,
        userRepository: routerDeps.repositories.userRepository,
      }),
      updateContent: new UpdateContentUseCase({
        contentRepository: routerDeps.repositories.contentRepository,
        contentStorage: routerDeps.storage,
        scheduleRepository: routerDeps.repositories.scheduleRepository,
        displayEventPublisher: routerDeps.displayEventPublisher,
        userRepository: routerDeps.repositories.userRepository,
      }),
      deleteContent: new DeleteContentUseCase({
        contentRepository: routerDeps.repositories.contentRepository,
        contentStorage: routerDeps.storage,
        scheduleRepository: routerDeps.repositories.scheduleRepository,
        cleanupFailureLogger,
        contentPlaylistReportingService,
      }),
      getDownloadUrl: new GetContentDownloadUrlUseCase({
        contentRepository: routerDeps.repositories.contentRepository,
        contentStorage: routerDeps.storage,
        expiresInSeconds: routerDeps.downloadUrlExpiresInSeconds,
      }),
      initPdfCrop: new InitPdfCropUseCase({
        contentStorage: routerDeps.storage,
        pdfCropSessionStore: routerDeps.pdfCropSessionStore,
        pdfPageExtractor: routerDeps.pdfPageExtractor,
        userRepository: routerDeps.repositories.userRepository,
      }),
      submitPdfCrop: new SubmitPdfCropUseCase({
        contentStorage: routerDeps.storage,
        contentRepository: routerDeps.repositories.contentRepository,
        pdfCropSessionStore: routerDeps.pdfCropSessionStore,
        pdfCropRenderer: routerDeps.pdfCropRenderer,
        contentThumbnailGenerator: routerDeps.contentThumbnailGenerator,
        userRepository: routerDeps.repositories.userRepository,
      }),
      cancelPdfCrop: new CancelPdfCropUseCase({
        contentStorage: routerDeps.storage,
        pdfCropSessionStore: routerDeps.pdfCropSessionStore,
      }),
    },
  };
};
