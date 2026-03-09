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
  type ContentJobEventSubscription,
} from "#/application/ports/content-jobs";
import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  type CreateFlashContentUseCase,
  type DeleteContentUseCase,
  type GetContentDownloadUrlUseCase,
  type GetContentJobUseCase,
  type GetContentUseCase,
  type ListContentOptionsUseCase,
  type ListContentUseCase,
  type ReplaceContentFileUseCase,
  type SetContentExclusionUseCase,
  type UpdateContentUseCase,
  type UploadContentUseCase,
} from "#/application/use-cases/content";
import { type CheckPermissionUseCase } from "#/application/use-cases/rbac";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";

export interface ContentRouterDeps {
  jwtSecret: string;
  authSessionRepository: AuthSessionRepository;
  authSessionCookieName: string;
  maxUploadBytes: number;
  videoMaxUploadBytes: number;
  downloadUrlExpiresInSeconds: number;
  thumbnailUrlExpiresInSeconds: number;
  repositories: {
    contentRepository: ContentRepository;
    contentIngestionJobRepository: ContentIngestionJobRepository;
    scheduleRepository: ScheduleRepository;
    userRepository: UserRepository;
    authorizationRepository: AuthorizationRepository;
  };
  storage: ContentStorage;
  contentIngestionQueue: ContentIngestionQueue;
  contentMetadataExtractor: ContentMetadataExtractor;
  contentThumbnailGenerator: ContentThumbnailGenerator;
  contentJobEventPublisher: ContentJobEventPublisher;
  contentJobEventSubscription: ContentJobEventSubscription;
  displayEventPublisher: DisplayStreamEventPublisher;
  checkPermissionUseCase: CheckPermissionUseCase;
}

export interface ContentRouterUseCases {
  uploadContent: UploadContentUseCase;
  replaceContentFile: ReplaceContentFileUseCase;
  listContent: ListContentUseCase;
  listContentOptions: ListContentOptionsUseCase;
  getContent: GetContentUseCase;
  getContentJob: GetContentJobUseCase;
  createFlashContent: CreateFlashContentUseCase;
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
